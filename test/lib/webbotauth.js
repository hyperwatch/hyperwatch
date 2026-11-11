const assert = require('assert');
const crypto = require('crypto');

const {
  KeyStore,
  directoryMaxAge,
  fetchDirectory,
  keysFromJwks,
  thumbprint,
  verify,
} = require('../../src/lib/webbotauth');

const agent = 'https://bot.example';
const time = 1800000000;

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { jwk, privateKey, keyid: thumbprint(jwk) };
}

// A request signed like the robots do: @authority and signature-agent
function signedRequest(
  { privateKey, keyid },
  {
    authority = 'www.example.com',
    host = authority,
    signatureAgent = `"${agent}"`,
    created = time,
    expires = time + 300,
    label = 'sig1',
    tag = 'web-bot-auth',
    components = ['@authority', 'signature-agent'],
    alg = 'ed25519',
    extra = '',
  } = {}
) {
  const values = {
    '@authority': authority,
    'signature-agent': signatureAgent,
  };
  const timing = [
    created === null ? '' : `;created=${created}`,
    expires === null ? '' : `;expires=${expires}`,
  ].join('');
  const params = `(${components.map((c) => `"${c}"`).join(' ')})${timing};keyid="${keyid}"${alg ? `;alg="${alg}"` : ''};tag="${tag}"${extra}`;
  const base = [
    ...components.map((c) => `"${c}": ${values[c]}`),
    `"@signature-params": ${params}`,
  ].join('\n');
  const signature = crypto
    .sign(null, Buffer.from(base), privateKey)
    .toString('base64');
  return {
    method: 'GET',
    url: '/page',
    headers: {
      host,
      'signature-agent': signatureAgent,
      'signature-input': `${label}=${params}`,
      signature: `${label}=:${signature}:`,
    },
  };
}

// A response of a key directory
function directoryResponse(
  jwks,
  {
    maxAge = 3600,
    type = 'application/http-message-signatures-directory+json',
  } = {}
) {
  return {
    ok: true,
    status: 200,
    headers: new Map([
      ['content-type', type],
      ['cache-control', `max-age=${maxAge}`],
    ]),
    text: async () => JSON.stringify({ keys: jwks }),
  };
}

// A fetch serving key directories, counting its calls
function directoryFetch(directories, { maxAge = 3600 } = {}) {
  const fetch = async (url, options) => {
    fetch.calls.push({ url: String(url), options });
    const jwks = directories[new URL(url).origin];
    return jwks
      ? directoryResponse(jwks, { maxAge })
      : { ok: false, status: 404 };
  };
  fetch.calls = [];
  return fetch;
}

describe('web bot auth', () => {
  describe('keys', () => {
    it('keeps Ed25519 keys by thumbprint, and skips the others', () => {
      const { jwk, keyid } = keyPair();
      const keys = keysFromJwks([jwk, { kty: 'RSA', n: 'x', e: 'AQAB' }, null]);
      assert.deepStrictEqual([...keys.keys()], [keyid]);
    });

    it('also keeps a key by its kid, when the directory gives one', () => {
      const { jwk, keyid } = keyPair();
      const keys = keysFromJwks([{ ...jwk, kid: 'short' }]);
      assert.deepStrictEqual([...keys.keys()], [keyid, 'short']);
    });

    it('keeps a directory for its max-age, between 5 minutes and a day', () => {
      assert.strictEqual(directoryMaxAge('max-age=3600'), 3600);
      assert.strictEqual(directoryMaxAge('public, max-age=10'), 300);
      assert.strictEqual(directoryMaxAge('max-age=999999'), 86400);
      assert.strictEqual(directoryMaxAge('no-store'), 300);
      assert.strictEqual(directoryMaxAge(null), 300);
    });
  });

  describe('verify', () => {
    const pair = keyPair();
    const store = () =>
      new KeyStore({
        agents: [agent],
        committed: { [agent]: [pair.jwk] },
        fetchKeys: false,
      });
    const check = (request, options = {}) =>
      verify(request, {
        keyStore: store(),
        authorities: ['www.example.com'],
        time,
        ...options,
      });

    it('verifies a signature of a known agent', async () => {
      assert.deepStrictEqual(await check(signedRequest(pair)), {
        agent,
        keyid: pair.keyid,
        verified: true,
        reason: 'verified',
      });
    });

    it("verifies a signature whose keyid is the key's kid", async () => {
      const store = new KeyStore({
        agents: [agent],
        committed: { [agent]: [{ ...pair.jwk, kid: 'short' }] },
        fetchKeys: false,
      });
      const request = signedRequest({ ...pair, keyid: 'short' });
      assert.deepStrictEqual(await check(request, { keyStore: store }), {
        agent,
        keyid: 'short',
        verified: true,
        reason: 'verified',
      });
      // Without the kid in the directory, the key is unknown
      assert.strictEqual((await check(request)).reason, 'unknown key');
    });

    it('ignores requests without a Web Bot Auth signature', async () => {
      assert.strictEqual(
        await check({ method: 'GET', url: '/', headers: {} }),
        undefined
      );
      assert.strictEqual(
        await check(signedRequest(pair, { tag: 'other' })),
        undefined
      );
    });

    it('checks the signature against the public host', async () => {
      const request = signedRequest(pair, { host: 'internal.example' });
      assert.strictEqual(
        (await check(request, { authorities: ['internal.example'] })).reason,
        'bad signature'
      );
      assert.strictEqual(
        (
          await check(request, {
            authorities: ['www.example.com', 'internal.example'],
          })
        ).reason,
        'verified'
      );
    });

    it('rejects a signature of another agent, or altered', async () => {
      const other = keyPair();
      assert.strictEqual(
        (await check(signedRequest(other))).reason,
        'unknown key'
      );
      const request = signedRequest(pair);
      request.headers['signature-agent'] = '"https://bot.example" ';
      assert.strictEqual((await check(request)).reason, 'verified');
      request.headers.signature = request.headers.signature.replace(
        /:(.)/,
        (match, c) => `:${c === 'A' ? 'B' : 'A'}`
      );
      assert.strictEqual((await check(request)).reason, 'bad signature');
    });

    it('rejects expired and future signatures, with a minute of skew', async () => {
      assert.strictEqual(
        (await check(signedRequest(pair), { time: time + 300 + 59 })).reason,
        'verified'
      );
      assert.strictEqual(
        (await check(signedRequest(pair), { time: time + 300 + 61 })).reason,
        'expired'
      );
      assert.strictEqual(
        (await check(signedRequest(pair), { time: time - 61 })).reason,
        'not yet valid'
      );
    });

    it("doesn't fetch the directory of an unknown agent", async () => {
      const fetch = directoryFetch({});
      const keyStore = new KeyStore({ agents: [agent], fetch });
      const request = signedRequest(pair, {
        signatureAgent: '"https://unknown.example"',
      });
      const result = await verify(request, {
        keyStore,
        authorities: ['www.example.com'],
        time,
      });
      assert.strictEqual(result.reason, 'unknown agent');
      assert.strictEqual(result.agent, 'https://unknown.example');
      assert.strictEqual(fetch.calls.length, 0);
    });

    it('checks every Web Bot Auth signature, whatever their order', async () => {
      const valid = signedRequest(pair, { label: 'sig2' });
      const unknown = signedRequest(keyPair(), { label: 'sig1' });
      const request = {
        ...valid,
        headers: {
          ...valid.headers,
          'signature-input': `${unknown.headers['signature-input']}, ${valid.headers['signature-input']}`,
          signature: `${unknown.headers.signature}, ${valid.headers.signature}`,
        },
      };
      assert.strictEqual((await check(request)).reason, 'verified');
      // None verifies: the first failure
      const both = {
        ...request,
        headers: {
          ...request.headers,
          signature: `${unknown.headers.signature}, sig2=:AAAA:`,
        },
      };
      assert.strictEqual((await check(both)).reason, 'unknown key');
    });

    it('serializes the signature parameters, whatever their spacing', async () => {
      const request = signedRequest(pair);
      request.headers['signature-input'] = request.headers['signature-input']
        .replace('" "', '"  "')
        .replace(/;/g, '; ');
      assert.strictEqual((await check(request)).reason, 'verified');
    });

    it('applies the Web Bot Auth profile', async () => {
      const reasonOf = async (options) =>
        (await check(signedRequest(pair, options))).reason;
      // created, expires and (in web-bot-auth 0.2.0) alg are required
      assert.strictEqual(await reasonOf({ expires: null }), 'policy');
      assert.strictEqual(await reasonOf({ alg: null }), 'policy');
      assert.strictEqual(await reasonOf({ created: null }), 'policy');
      // The authority and the Signature-Agent must be covered
      assert.strictEqual(
        await reasonOf({ components: ['signature-agent'] }),
        'policy'
      );
      assert.strictEqual(
        await reasonOf({ components: ['@authority'] }),
        'policy'
      );
      // At most a day old
      assert.strictEqual(
        (
          await check(
            signedRequest(pair, { created: time - 90000, expires: time + 300 })
          )
        ).reason,
        'too old'
      );
      // A nonce, when there is one, of 64 bytes
      const short = await check(
        signedRequest(pair, {
          extra: `;nonce="${Buffer.alloc(16, 1).toString('base64')}"`,
        })
      );
      assert.strictEqual(short.reason, 'policy');
      assert.match(short.detail, /nonce/);
      assert.strictEqual(
        await reasonOf({
          extra: `;nonce="${crypto.randomBytes(64).toString('base64')}"`,
        }),
        'verified'
      );
    });

    it('rejects components that are not strings, without throwing', async () => {
      const request = signedRequest(pair);
      request.headers['signature-input'] =
        `sig1=(1 "@authority");keyid="${pair.keyid}";tag="web-bot-auth"`;
      assert.strictEqual((await check(request)).reason, 'malformed');
    });

    it('reports a missing agent and malformed headers', async () => {
      // No Signature-Agent at all: no directory to find the key in
      const request = signedRequest(pair, { components: ['@authority'] });
      delete request.headers['signature-agent'];
      assert.strictEqual((await check(request)).reason, 'no agent');
      // A covered Signature-Agent that is missing
      const missing = signedRequest(pair);
      delete missing.headers['signature-agent'];
      assert.strictEqual((await check(missing)).reason, 'malformed');
      const malformed = signedRequest(pair);
      malformed.headers['signature-input'] = 'sig1=("@authority"';
      assert.strictEqual((await check(malformed)).reason, 'malformed');
    });
  });

  describe('fetchDirectory', () => {
    const { jwk } = keyPair();

    it('reads the Ed25519 keys and the max-age, without following redirects', async () => {
      const fetch = directoryFetch({ [agent]: [jwk] }, { maxAge: 600 });
      const { jwks, maxAge } = await fetchDirectory(agent, { fetch });
      assert.deepStrictEqual(jwks, [{ kty: jwk.kty, crv: jwk.crv, x: jwk.x }]);
      const withKid = await fetchDirectory(agent, {
        fetch: directoryFetch({ [agent]: [{ ...jwk, kid: 'short' }] }),
      });
      assert.strictEqual(withKid.jwks[0].kid, 'short');
      assert.strictEqual(maxAge, 600);
      assert.strictEqual(fetch.calls[0].options.redirect, 'error');
    });

    it('rejects another media type, a large body or no key', async () => {
      const serve = (response) => async () => response;
      await assert.rejects(
        fetchDirectory(agent, {
          fetch: serve(directoryResponse([jwk], { type: 'application/json' })),
        }),
        /media type/
      );
      const large = directoryResponse([jwk]);
      large.text = async () => ' '.repeat(64 * 1024 + 1);
      await assert.rejects(
        fetchDirectory(agent, { fetch: serve(large) }),
        /too large/
      );
      await assert.rejects(
        fetchDirectory(agent, { fetch: serve(directoryResponse([])) }),
        /no Ed25519 key/
      );
    });
  });

  describe('KeyStore', () => {
    it('replaces the committed keys with the fetched ones', async () => {
      const old = keyPair();
      const current = keyPair();
      const fetch = directoryFetch({ [agent]: [current.jwk] });
      const keyStore = new KeyStore({
        agents: [agent],
        committed: { [agent]: [old.jwk] },
        fetch,
        now: () => time,
      });
      assert.ok(await keyStore.get(agent, current.keyid));
      // The key the operator removed is no longer trusted
      assert.strictEqual(await keyStore.get(agent, old.keyid), null);
      assert.strictEqual(fetch.calls.length, 1);
      assert.strictEqual(
        fetch.calls[0].url,
        `${agent}/.well-known/http-message-signatures-directory`
      );
      assert.strictEqual(fetch.calls[0].options.redirect, 'error');
    });

    it('fetches again for an unknown key at most once a minute', async () => {
      const first = keyPair();
      const rotated = keyPair();
      const directories = { [agent]: [first.jwk] };
      const fetch = directoryFetch(directories);
      let now = time;
      const keyStore = new KeyStore({ agents: [agent], fetch, now: () => now });
      assert.ok(await keyStore.get(agent, first.keyid));
      directories[agent] = [rotated.jwk];
      now += 30;
      assert.strictEqual(await keyStore.get(agent, rotated.keyid), null);
      assert.strictEqual(fetch.calls.length, 1);
      now += 31;
      assert.ok(await keyStore.get(agent, rotated.keyid));
      assert.strictEqual(fetch.calls.length, 2);
    });

    it('waits for a fetch in progress before reporting an unknown key', async () => {
      const rotated = keyPair();
      let release;
      const fetch = () =>
        new Promise((resolve) => {
          release = () => resolve(directoryResponse([rotated.jwk]));
        });
      const keyStore = new KeyStore({
        agents: [agent],
        fetch,
        now: () => time,
      });
      const first = keyStore.get(agent, rotated.keyid);
      const second = keyStore.get(agent, rotated.keyid);
      release();
      assert.ok(await first);
      assert.ok(await second);
    });

    it('fetches again when the max-age is over', async () => {
      const pair = keyPair();
      const fetch = directoryFetch({ [agent]: [pair.jwk] }, { maxAge: 600 });
      let now = time;
      const keyStore = new KeyStore({ agents: [agent], fetch, now: () => now });
      await keyStore.get(agent, pair.keyid);
      now += 599;
      await keyStore.get(agent, pair.keyid);
      assert.strictEqual(fetch.calls.length, 1);
      now += 2;
      await keyStore.get(agent, pair.keyid);
      assert.strictEqual(fetch.calls.length, 2);
    });

    it('keeps the last good keys when a fetch fails', async () => {
      const pair = keyPair();
      const keyStore = new KeyStore({
        agents: [agent],
        committed: { [agent]: [pair.jwk] },
        fetch: directoryFetch({}),
        now: () => time,
      });
      assert.ok(await keyStore.get(agent, pair.keyid));
    });

    it('uses the committed keys only when fetching is off', async () => {
      const pair = keyPair();
      const fetch = directoryFetch({});
      const keyStore = new KeyStore({
        agents: [agent],
        committed: { [agent]: [pair.jwk] },
        fetchKeys: false,
        fetch,
      });
      assert.ok(await keyStore.get(agent, pair.keyid));
      assert.strictEqual(fetch.calls.length, 0);
    });
  });
});
