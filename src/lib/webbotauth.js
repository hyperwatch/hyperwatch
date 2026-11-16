// Web Bot Auth: requests signed with HTTP Message Signatures (RFC 9421),
// keys published in a key directory
// (/.well-known/http-message-signatures-directory).
// https://datatracker.ietf.org/wg/webbotauth/about/
//
// Signatures are verified by Cloudflare's web-bot-auth package (vendored at a
// commit following draft-ietf-webbotauth-httpsig-protocol-01, see
// src/vendor/web-bot-auth/README.md), which applies the Web Bot Auth profile
// (created, expires, keyid and tag required, the authority and
// Signature-Agent covered, at most a day old). This file keeps
// the keys of the known agents and turns the outcome into a result for logs.

const crypto = require('crypto');

const { parseDictionary } = require('structured-headers');

const { verifierFromJWK } = require('../vendor/web-bot-auth/crypto.cjs');
const {
  HTTP_MESSAGE_SIGNATURE_TAG,
  HTTP_MESSAGE_SIGNATURES_DIRECTORY,
  parseSignatureAgentHeader,
  verify: verifySignature,
} = require('../vendor/web-bot-auth/index.cjs');

const directoryMediaType = 'application/http-message-signatures-directory+json';
const directoryMaxBytes = 64 * 1024;
const clockSkew = 60;

/**
 * An Ed25519 public key, as a JWK, with the `kid` its directory gives it if
 * any
 * @typedef {{ kty: string, crv: string, x: string, kid?: string }} Ed25519Key
 */

/**
 * The keys of a known agent, by keyid, and where they come from
 * @typedef {object} KeyEntry
 * @property {Map<string, Ed25519Key>} keys
 * @property {'committed' | 'fetched'} source
 * @property {number} expires When fetched keys are due, in seconds
 * @property {number} lastAttempt The last fetch, in seconds
 * @property {Promise<void> | null} pending The fetch in progress
 */

/**
 * @typedef {object} KeyStoreOptions
 * @property {string[]} [agents] Agents whose directories may be fetched
 * @property {Record<string, object[]>} [committed] Keys per agent
 * @property {boolean} [fetchKeys] Fetch the directories
 * @property {typeof globalThis.fetch} [fetch]
 * @property {() => number} [now] Seconds since the epoch
 */

/**
 * A signed request, as verify() reads it
 * @typedef {object} SignedRequest
 * @property {string} [method] GET by default
 * @property {string} [url] The path and query, / by default
 * @property {string} [scheme] https by default
 * @property {Record<string, unknown>} headers Lowercase names
 */

/**
 * The Web Bot Auth signature of a request (`webbotauth` of a log, see
 * docs/log.md)
 * @typedef {object} WebBotAuthResult
 * @property {string | null} agent The agent verified, else the one claimed
 * @property {string | null} keyid
 * @property {boolean} verified
 * @property {string} reason `verified`, or why not
 * @property {string} [detail] Why a signature is outside the Web Bot Auth
 *   profile (reason `policy`)
 */

/**
 * The outcome of one signature for one authority
 * @typedef {object} SignatureResult
 * @property {string | null} [agent] The agent verified
 * @property {boolean} verified
 * @property {string} reason
 * @property {string} [detail]
 */

/**
 * An error of the web-bot-auth package: `code` names the failure, `cause` the
 * error it wraps
 * @typedef {Error & { code?: string, cause?: { message?: string } }} VerificationError
 */

// The origin of an agent URL, https only
/**
 * @param {string} value
 * @returns {string | null}
 */
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
/**
 * @param {{ kty?: string, crv?: string, x?: string }} jwk
 * @returns {string}
 */
function thumbprint(jwk) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
    .digest('base64url');
}

/**
 * @param {any} jwk JSON, from a directory or a file
 * @returns {jwk is Ed25519Key}
 */
const isEd25519 = (jwk) =>
  !!jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && !!jwk.x;

// The Ed25519 keys of a directory, by thumbprint, and by `kid` when the
// directory gives one: Web Bot Auth's keyid is the thumbprint, but some
// agents (Google's) sign with their own `kid`
/**
 * @param {readonly unknown[] | null} [jwks]
 * @returns {Map<string, Ed25519Key>}
 */
function keysFromJwks(jwks) {
  /** @type {Map<string, Ed25519Key>} */
  const keys = new Map();
  for (const jwk of jwks || []) {
    if (isEd25519(jwk)) {
      const { kty, crv, x } = jwk;
      const key = { kty, crv, x };
      keys.set(thumbprint(jwk), key);
      if (typeof jwk.kid === 'string' && jwk.kid && !keys.has(jwk.kid)) {
        keys.set(jwk.kid, key);
      }
    }
  }
  return keys;
}

// Seconds to keep a directory: its max-age, between 5 minutes and a day
/**
 * @param {string | null} [cacheControl]
 * @returns {number}
 */
function directoryMaxAge(cacheControl) {
  const min = 5 * 60;
  const max = 24 * 60 * 60;
  const match = /max-age=(\d+)/i.exec(cacheControl || '');
  const seconds = match ? Number(match[1]) : min;
  return Math.min(max, Math.max(min, seconds));
}

/**
 * @param {string} agent
 * @param {{ fetch?: typeof globalThis.fetch }} [options]
 * @returns {Promise<{ jwks: Ed25519Key[], maxAge: number }>}
 */
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
  /** @type {Ed25519Key[]} */
  const jwks = (JSON.parse(text).keys || []).filter(isEd25519);
  if (jwks.length === 0) {
    throw new Error('no Ed25519 key');
  }
  return {
    jwks: jwks.map(({ kty, crv, x, kid }) =>
      typeof kid === 'string' && kid ? { kty, crv, x, kid } : { kty, crv, x }
    ),
    maxAge: directoryMaxAge(response.headers.get('cache-control')),
  };
}

// The keys of the known agents: the committed ones first, then those fetched
// from their directories, which replace them (a key the operator removed may
// have leaked). Only known agents are ever fetched.
class KeyStore {
  /** @param {KeyStoreOptions} [options] */
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
    /** @type {Map<string, KeyEntry>} */
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

  /** @param {string} agent */
  has(agent) {
    return this.entries.has(agent);
  }

  // The JWK for keyid, fetching the directory when it is due or when the key
  // is unknown (a rotation), at most once a minute per agent
  /**
   * @param {string} agent
   * @param {string} keyid
   * @returns {Promise<Ed25519Key | null>}
   */
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

  /**
   * @param {string} agent A known agent
   * @returns {Promise<void> | null}
   */
  refresh(agent) {
    const entry = /** @type {KeyEntry} */ (this.entries.get(agent));
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

// One verifier per key, built once (by thumbprint: a `kid` is only unique
// within its directory). The package checks that the verifier's keyid, the
// thumbprint, is the signed one: a key found by its `kid` gets a verifier
// with that `kid` instead
/** @type {Map<string, Promise<import('../vendor/web-bot-auth/index.cjs').WebBotVerifier>>} */
const verifiers = new Map();
/**
 * @param {string} keyid
 * @param {Ed25519Key} jwk
 * @returns {Promise<import('../vendor/web-bot-auth/index.cjs').WebBotVerifier>}
 */
async function verifierFor(keyid, jwk) {
  const id = thumbprint(jwk);
  if (!verifiers.has(id)) {
    verifiers.set(id, verifierFromJWK(jwk));
  }
  const verifier =
    await /** @type {Promise<import('../vendor/web-bot-auth/index.cjs').WebBotVerifier>} */ (
      verifiers.get(id)
    );
  return keyid === id
    ? verifier
    : {
        algorithm: verifier.algorithm,
        keyid,
        verify: (
          /** @type {Uint8Array} */ data,
          /** @type {Uint8Array} */ signature
        ) => verifier.verify(data, signature),
      };
}

// --- Verification ---

// The labels of the Web Bot Auth signatures of a request
/** @param {string} signatureInput */
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
/**
 * @param {unknown} header
 * @param {string} label
 * @returns {string | null}
 */
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
/**
 * @param {VerificationError} error
 * @returns {string}
 */
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

/**
 * @param {SignedRequest} request
 * @param {string} label
 * @param {{ keyStore: KeyStore, authority: string, time: number }} options
 *   `time` in seconds
 * @returns {Promise<SignatureResult>}
 */
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
  /** @type {string | undefined} */
  let resolution;
  /** @param {import('../vendor/web-bot-auth/index.cjs').UntrustedWebBotSignatureCandidate} candidate */
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
      // Covered by the Web Bot Auth profile, so present
      agent: normalizeAgent(
        /** @type {import('../vendor/web-bot-auth/index.cjs').SignatureAgentEntry} */ (
          verified.signatureAgent
        ).uri
      ),
      verified: true,
      reason: 'verified',
    };
  } catch (/** @type {any} */ error) {
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
/**
 * @param {SignedRequest} request
 * @param {{ keyStore: KeyStore, authorities: string[], time: number }} options
 *   `time` in seconds
 * @returns {Promise<WebBotAuthResult | undefined>}
 */
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

  /** @type {WebBotAuthResult | undefined} */
  let failure;
  for (const { label, keyid } of labels) {
    const agent = claimedAgent(headers['signature-agent'], label);
    /** @type {SignatureResult | WebBotAuthResult | undefined} */
    let result;
    for (const authority of authorities) {
      result = await verifyOne(request, label, { keyStore, authority, time });
      // Another authority only changes the signed content
      if (result.reason !== 'bad signature') {
        break;
      }
    }
    // authorities isn't empty here: result is set
    const one = /** @type {SignatureResult} */ (result);
    result = {
      agent: one.agent || agent,
      keyid: typeof keyid === 'string' ? keyid : null,
      verified: one.verified,
      reason: one.reason,
      ...(one.detail && { detail: one.detail }),
    };
    if (result.verified) {
      return result;
    }
    failure = failure || result;
  }
  return failure;
}

module.exports.KeyStore = KeyStore;
module.exports.directoryMaxAge = directoryMaxAge;
module.exports.fetchDirectory = fetchDirectory;
module.exports.keysFromJwks = keysFromJwks;
module.exports.thumbprint = thumbprint;
module.exports.verify = verify;
