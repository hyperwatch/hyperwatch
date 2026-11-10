// Web Bot Auth: requests signed with HTTP Message Signatures (RFC 9421),
// Ed25519 keys published in a key directory
// (/.well-known/http-message-signatures-directory).
// https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/

const crypto = require('crypto');

const directoryPath = '/.well-known/http-message-signatures-directory';

// --- Structured fields (RFC 8941): the dictionaries of Signature-Input and
// Signature ---

function parseDictionary(text) {
  const members = new Map();
  let i = 0;

  const fail = (what) => {
    throw new Error(`${what} at ${i}`);
  };
  const skipSpaces = () => {
    while (text[i] === ' ' || text[i] === '\t') {
      i++;
    }
  };
  const parseKey = () => {
    const match = /^[a-z*][a-z0-9_.*-]*/.exec(text.slice(i));
    if (!match) {
      fail('bad key');
    }
    i += match[0].length;
    return match[0];
  };
  const parseBareItem = () => {
    if (text[i] === '"') {
      let value = '';
      i++;
      while (text[i] !== '"') {
        if (i >= text.length) {
          fail('unterminated string');
        }
        if (text[i] === '\\') {
          i++;
        }
        value += text[i++];
      }
      i++;
      return { type: 'string', value };
    }
    if (text[i] === ':') {
      const end = text.indexOf(':', i + 1);
      if (end < 0) {
        fail('unterminated byte sequence');
      }
      const value = Buffer.from(text.slice(i + 1, end), 'base64');
      i = end + 1;
      return { type: 'bytes', value };
    }
    if (text[i] === '?') {
      const value = text[i + 1] === '1';
      i += 2;
      return { type: 'boolean', value };
    }
    const number = /^-?\d+(\.\d+)?/.exec(text.slice(i));
    if (number) {
      i += number[0].length;
      return { type: 'number', value: Number(number[0]) };
    }
    const token = /^[A-Za-z*][!#$%&'*+\-.^_`|~0-9A-Za-z:/]*/.exec(
      text.slice(i)
    );
    if (token) {
      i += token[0].length;
      return { type: 'token', value: token[0] };
    }
    fail('bad value');
  };
  const parseParams = () => {
    const params = {};
    while (text[i] === ';') {
      i++;
      skipSpaces();
      const key = parseKey();
      params[key] = true;
      if (text[i] === '=') {
        i++;
        params[key] = parseBareItem().value;
      }
    }
    return params;
  };

  skipSpaces();
  while (i < text.length) {
    const key = parseKey();
    const start = text[i] === '=' ? i + 1 : i;
    let member;
    if (text[i] !== '=') {
      member = { value: true };
    } else if (text[++i] === '(') {
      i++;
      const items = [];
      for (;;) {
        skipSpaces();
        if (text[i] === ')') {
          i++;
          break;
        }
        if (i >= text.length) {
          fail('unterminated inner list');
        }
        const item = parseBareItem();
        items.push({ ...item, params: parseParams() });
      }
      member = { items };
    } else {
      member = parseBareItem();
    }
    member.params = parseParams();
    // As sent: the signature base repeats it in "@signature-params"
    member.raw = text.slice(start, i);
    members.set(key, member);
    skipSpaces();
    if (i >= text.length) {
      break;
    }
    if (text[i] !== ',') {
      fail('expected ","');
    }
    i++;
    skipSpaces();
  }
  return members;
}

// Signature-Agent: a string ("https://agent.example"), a dictionary of strings
// by signature label (newer drafts), or a bare URL as some robots send it
function parseSignatureAgent(value, label) {
  const text = String(value).trim();
  if (text.startsWith('"')) {
    try {
      const [member] = parseDictionary(`a=${text}`).values();
      return normalizeAgent(member.value);
    } catch (error) {
      return null;
    }
  }
  if (/^[a-z*][a-z0-9_.*-]*=/.test(text)) {
    try {
      const member = parseDictionary(text).get(label);
      return member && member.type === 'string'
        ? normalizeAgent(member.value)
        : null;
    } catch (error) {
      return null;
    }
  }
  return normalizeAgent(text);
}

// The origin of an agent URL, without a trailing slash
function normalizeAgent(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch (error) {
    return null;
  }
}

// --- Signature base (RFC 9421 §2.5) ---

// The value of a covered component, or undefined when the request lacks it
function componentValue(name, request, authority) {
  const url = request.url || '';
  const queryAt = url.indexOf('?');
  switch (name) {
    case '@authority':
      return authority;
    case '@method':
      return request.method;
    case '@path':
      return queryAt < 0 ? url : url.slice(0, queryAt);
    case '@query':
      return queryAt < 0 ? '?' : url.slice(queryAt);
    case '@request-target':
      return url;
    case '@scheme':
      return request.scheme || 'https';
    case '@target-uri':
      return `${request.scheme || 'https'}://${authority}${url}`;
    default: {
      if (name.startsWith('@')) {
        return undefined;
      }
      const value = request.headers[name];
      return value === undefined ? undefined : String(value).trim();
    }
  }
}

function signatureBase(input, request, authority) {
  const lines = [];
  for (const item of input.items) {
    // Components are strings: anything else is not a valid Signature-Input
    if (item.type !== 'string') {
      return { reason: 'malformed' };
    }
    if (Object.keys(item.params).length > 0) {
      return { reason: 'unsupported component' };
    }
    const value = componentValue(item.value, request, authority);
    if (value === undefined) {
      return { reason: 'missing component' };
    }
    lines.push(`"${item.value}": ${value}`);
  }
  lines.push(`"@signature-params": ${input.raw}`);
  return { base: Buffer.from(lines.join('\n')) };
}

// --- Keys ---

// RFC 7638 thumbprint of an Ed25519 JWK: the keyid of its signatures
function thumbprint(jwk) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x }))
    .digest('base64url');
}

// The Ed25519 keys of a directory, by thumbprint
function keysFromJwks(jwks) {
  const keys = new Map();
  for (const jwk of jwks || []) {
    if (jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x) {
      try {
        keys.set(
          thumbprint(jwk),
          crypto.createPublicKey({
            key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
            format: 'jwk',
          })
        );
      } catch (error) {
        // Not a valid key: skipped
      }
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
  const response = await fetch(new URL(directoryPath, agent), {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = await response.json();
  const jwks = (body.keys || []).filter(
    (jwk) => jwk && jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && jwk.x
  );
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

  // The key for keyid, fetching the directory when it is due or when the key
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

// --- Verification ---

const skew = 60;

// The Web Bot Auth signature of a request: undefined when it has none,
// otherwise { agent, keyid, verified, reason }. `authorities` are the hosts
// the client may have signed for (behind a proxy, the public host is not
// always the Host header).
async function verify(request, { keyStore, authorities, time }) {
  const headers = request.headers || {};
  if (!headers['signature-input'] || !headers.signature) {
    return undefined;
  }
  let inputs;
  let signatures;
  try {
    inputs = parseDictionary(String(headers['signature-input']));
    signatures = parseDictionary(String(headers.signature));
  } catch (error) {
    return { agent: null, keyid: null, verified: false, reason: 'malformed' };
  }

  for (const [label, input] of inputs) {
    if (!input.items || input.params.tag !== 'web-bot-auth') {
      continue;
    }
    const keyid =
      typeof input.params.keyid === 'string' ? input.params.keyid : null;
    const agent = headers['signature-agent']
      ? parseSignatureAgent(headers['signature-agent'], label)
      : null;
    const result = (verified, reason) => ({ agent, keyid, verified, reason });

    if (!agent) {
      return result(false, 'no agent');
    }
    if (!keyStore.has(agent)) {
      return result(false, 'unknown agent');
    }
    const signature = signatures.get(label);
    if (!signature || signature.type !== 'bytes') {
      return result(false, 'malformed');
    }
    const { created, expires } = input.params;
    if (typeof created === 'number' && created > time + skew) {
      return result(false, 'not yet valid');
    }
    if (typeof expires === 'number' && expires < time - skew) {
      return result(false, 'expired');
    }
    const key = await keyStore.get(agent, keyid);
    if (!key) {
      return result(false, 'unknown key');
    }
    for (const authority of authorities) {
      const { base, reason } = signatureBase(input, request, authority);
      if (!base) {
        return result(false, reason);
      }
      if (crypto.verify(null, base, key, signature.value)) {
        return result(true, 'verified');
      }
    }
    return result(false, 'bad signature');
  }
  return undefined;
}

module.exports = {
  KeyStore,
  directoryMaxAge,
  directoryPath,
  fetchDirectory,
  keysFromJwks,
  parseDictionary,
  parseSignatureAgent,
  signatureBase,
  thumbprint,
  verify,
};
