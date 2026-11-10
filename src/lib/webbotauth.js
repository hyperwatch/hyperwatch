// Web Bot Auth: requests signed with HTTP Message Signatures (RFC 9421),
// keys published in a key directory
// (/.well-known/http-message-signatures-directory).
// https://datatracker.ietf.org/wg/webbotauth/about/
//
// Signatures are verified by Cloudflare's web-bot-auth package, which applies
// the Web Bot Auth profile (created, expires, keyid and tag required, the
// authority and Signature-Agent covered, at most a day old). This file keeps
// the keys of the known agents and turns the outcome into a result for logs.

const crypto = require('crypto');

const { parseDictionary } = require('structured-headers');
const {
  HTTP_MESSAGE_SIGNATURE_TAG,
  HTTP_MESSAGE_SIGNATURES_DIRECTORY,
  parseSignatureAgentHeader,
  verify: verifySignature,
} = require('web-bot-auth');
const { verifierFromJWK } = require('web-bot-auth/crypto');

const directoryMediaType = 'application/http-message-signatures-directory+json';
const directoryMaxBytes = 64 * 1024;
const clockSkew = 60;

// The origin of an agent URL, https only
function normalizeAgent(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch (error) {
    return null;
  }
}

// --- Keys ---

// RFC 7638 thumbprint of an Ed25519 JWK: the keyid of its signatures
function thumbprint(jwk) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
    .digest('base64url');
}

const isEd25519 = (jwk) =>
  !!jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && !!jwk.x;

// The Ed25519 keys of a directory, by thumbprint
function keysFromJwks(jwks) {
  const keys = new Map();
  for (const jwk of jwks || []) {
    if (isEd25519(jwk)) {
      const { kty, crv, x } = jwk;
      keys.set(thumbprint(jwk), { kty, crv, x });
    }
  }
  return keys;
}

// Seconds to keep a directory: its max-age, between 5 minutes and a day
function directoryMaxAge(cacheControl) {
  const min = 5 * 60;
  const max = 24 * 60 * 60;
  const match = /max-age=(\d+)/i.exec(cacheControl || '');
  const seconds = match ? Number(match[1]) : min;
  return Math.min(max, Math.max(min, seconds));
}

async function fetchDirectory(agent, { fetch = globalThis.fetch } = {}) {
  const response = await fetch(
    new URL(HTTP_MESSAGE_SIGNATURES_DIRECTORY, agent),
    { redirect: 'error', signal: AbortSignal.timeout(5000) }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const type = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (type !== directoryMediaType) {
    throw new Error(`unexpected media type "${type}"`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > directoryMaxBytes) {
    throw new Error('directory too large');
  }
  const jwks = (JSON.parse(text).keys || []).filter(isEd25519);
  if (jwks.length === 0) {
    throw new Error('no Ed25519 key');
  }
  return {
    jwks: jwks.map(({ kty, crv, x }) => ({ kty, crv, x })),
    maxAge: directoryMaxAge(response.headers.get('cache-control')),
  };
}

// The keys of the known agents: the committed ones first, then those fetched
// from their directories, which replace them (a key the operator removed may
// have leaked). Only known agents are ever fetched.
class KeyStore {
  constructor({
    agents = [],
    committed = {},
    fetchKeys = true,
    fetch,
    now = () => Date.now() / 1000,
  } = {}) {
    this.fetchKeys = fetchKeys;
    this.fetch = fetch;
    this.now = now;
    this.entries = new Map();
    for (const agent of agents) {
      this.entries.set(agent, {
        keys: keysFromJwks(committed[agent]),
        source: 'committed',
        expires: 0,
        lastAttempt: 0,
        pending: null,
      });
    }
  }

  has(agent) {
    return this.entries.has(agent);
  }

  // The JWK for keyid, fetching the directory when it is due or when the key
  // is unknown (a rotation), at most once a minute per agent
  async get(agent, keyid) {
    const entry = this.entries.get(agent);
    if (!entry) {
      return null;
    }
    // A fetch in progress may bring the key: wait for it
    if (entry.pending) {
      await entry.pending;
    }
    const now = this.now();
    const due =
      entry.source === 'committed' ||
      now >= entry.expires ||
      !entry.keys.has(keyid);
    if (this.fetchKeys && due && now - entry.lastAttempt >= 60) {
      await this.refresh(agent);
    }
    return entry.keys.get(keyid) || null;
  }

  refresh(agent) {
    const entry = this.entries.get(agent);
    if (!entry.pending) {
      entry.lastAttempt = this.now();
      entry.pending = fetchDirectory(agent, { fetch: this.fetch })
        .then(({ jwks, maxAge }) => {
          entry.keys = keysFromJwks(jwks);
          entry.source = 'fetched';
          entry.expires = this.now() + maxAge;
        })
        .catch(() => {
          // Keep the last good keys (fetched, else committed)
        })
        .finally(() => {
          entry.pending = null;
        });
    }
    return entry.pending;
  }
}

// One verifier per key, built once
const verifiers = new Map();
function verifierFor(keyid, jwk) {
  if (!verifiers.has(keyid)) {
    verifiers.set(keyid, verifierFromJWK(jwk));
  }
  return verifiers.get(keyid);
}

// --- Verification ---

// The labels of the Web Bot Auth signatures of a request
function webBotAuthLabels(signatureInput) {
  const labels = [];
  for (const [label, [value, params]] of parseDictionary(signatureInput)) {
    if (
      Array.isArray(value) &&
      params.get('tag') === HTTP_MESSAGE_SIGNATURE_TAG
    ) {
      labels.push({ label, keyid: params.get('keyid') });
    }
  }
  return labels;
}

// The agent a signature claims, for reports: its Signature-Agent member, or
// the only one
function claimedAgent(header, label) {
  if (!header) {
    return null;
  }
  try {
    const { kind, entries } = parseSignatureAgentHeader(String(header));
    const entry =
      kind === 'legacy'
        ? entries[0]
        : entries.find((candidate) => candidate.label === label);
    return entry ? normalizeAgent(entry.uri) : null;
  } catch (error) {
    return null;
  }
}

// The result of a failed verification, from the package's error
function failureReason(error) {
  const message = String((error.cause && error.cause.message) || error.message);
  switch (error.code) {
    case 'VerificationFailed':
      return 'bad signature';
    case 'PolicyViolation':
      if (/expired/.test(message)) {
        return 'expired';
      }
      if (/in the future/.test(message)) {
        return 'not yet valid';
      }
      if (/too old/.test(message)) {
        return 'too old';
      }
      return 'policy';
    case 'UnsupportedFeature':
    case 'AlgorithmMismatch':
      return 'unsupported';
    case 'ResolverFailed':
      return 'policy';
    default:
      return 'malformed';
  }
}

async function verifyOne(request, label, { keyStore, authority, time }) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name !== 'host' && value !== undefined && value !== null) {
      headers.set(name, String(value));
    }
  }
  const scheme = request.scheme || 'https';
  const fetchRequest = new Request(
    `${scheme}://${authority}${request.url || '/'}`,
    { method: request.method || 'GET', headers }
  );

  // Our own outcome of key resolution, which the package wraps
  let resolution;
  const resolver = async (candidate) => {
    const agent = candidate.signatureAgent
      ? normalizeAgent(candidate.signatureAgent.uri)
      : null;
    if (!agent) {
      resolution = 'no agent';
    } else if (!keyStore.has(agent)) {
      resolution = 'unknown agent';
    } else if (candidate.algorithm && candidate.algorithm !== 'ed25519') {
      resolution = 'unsupported';
    } else {
      const jwk = await keyStore.get(agent, candidate.keyid);
      if (jwk) {
        return verifierFor(candidate.keyid, jwk);
      }
      resolution = 'unknown key';
    }
    throw new Error(resolution);
  };

  try {
    const verified = await verifySignature(fetchRequest, {
      resolver,
      label,
      algorithms: ['ed25519'],
      clockSkew,
      now: new Date(time * 1000),
    });
    return {
      agent: normalizeAgent(verified.signatureAgent.uri),
      verified: true,
      reason: 'verified',
    };
  } catch (error) {
    const reason =
      error.code === 'ResolverFailed' && resolution
        ? resolution
        : failureReason(error);
    return {
      verified: false,
      reason,
      ...(reason === 'policy' && {
        detail: String((error.cause && error.cause.message) || error.message),
      }),
    };
  }
}

// The Web Bot Auth signature of a request: undefined when it has none,
// otherwise { agent, keyid, verified, reason[, detail] }. Every Web Bot Auth
// signature is checked: the first verified one wins, else the first failure
// is reported. `authorities` are the hosts the client may have signed for
// (behind a proxy, the public host is not always the Host header).
async function verify(request, { keyStore, authorities, time }) {
  const headers = request.headers || {};
  if (!headers['signature-input']) {
    return undefined;
  }
  let labels;
  try {
    labels = webBotAuthLabels(String(headers['signature-input']));
  } catch (error) {
    return { agent: null, keyid: null, verified: false, reason: 'malformed' };
  }

  if (labels.length > 0 && authorities.length === 0) {
    return { agent: null, keyid: null, verified: false, reason: 'malformed' };
  }

  let failure;
  for (const { label, keyid } of labels) {
    const agent = claimedAgent(headers['signature-agent'], label);
    let result;
    for (const authority of authorities) {
      result = await verifyOne(request, label, { keyStore, authority, time });
      // Another authority only changes the signed content
      if (result.reason !== 'bad signature') {
        break;
      }
    }
    result = {
      agent: result.agent || agent,
      keyid: typeof keyid === 'string' ? keyid : null,
      verified: result.verified,
      reason: result.reason,
      ...(result.detail && { detail: result.detail }),
    };
    if (result.verified) {
      return result;
    }
    failure = failure || result;
  }
  return failure;
}

module.exports = {
  KeyStore,
  directoryMaxAge,
  fetchDirectory,
  keysFromJwks,
  thumbprint,
  verify,
};
