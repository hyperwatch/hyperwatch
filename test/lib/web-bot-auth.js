const assert = require('assert');
const crypto = require('crypto');

const {
  KeyStore,
  directoryMaxAge,
  keysFromJwks,
  parseDictionary,
  parseSignatureAgent,
  thumbprint,
  verify,
} = require('../../src/lib/web-bot-auth');

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
  } = {}
) {
  const params = `("@authority" "signature-agent");created=${created};expires=${expires};keyid="${keyid}";tag="${tag}"`;
  const base = [
    `"@authority": ${authority}`,
    `"signature-agent": ${signatureAgent}`,
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

// A fetch serving key directories, counting its calls
function directoryFetch(directories, { maxAge = 3600 } = {}) {
  const fetch = async (url, options) => {
    fetch.calls.push({ url: String(url), options });
    const jwks = directories[new URL(url).origin];
    if (!jwks) {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      status: 200,
      headers: new Map([['cache-control', `max-age=${maxAge}`]]),
      json: async () => ({ keys: jwks }),
    };
  };
  fetch.calls = [];
  return fetch;
}

describe('web bot auth', () => {
  describe('parseDictionary', () => {
    it('reads inner lists with parameters, and keeps them as sent', () => {
      const members = parseDictionary(
        'sig1=("@authority" "signature-agent");created=1;keyid="k";tag="web-bot-auth", sig2=:AAEC:'
      );
      const sig1 = members.get('sig1');
      assert.deepStrictEqual(
        sig1.items.map((item) => item.value),
        ['@authority', 'signature-agent']
      );
      assert.deepStrictEqual(sig1.params, {
        created: 1,
        keyid: 'k',
        tag: 'web-bot-auth',
      });
      assert.strictEqual(
        sig1.raw,
        '("@authority" "signature-agent");created=1;keyid="k";tag="web-bot-auth"'
      );
      assert.deepStrictEqual([...members.get('sig2').value], [0, 1, 2]);
    });

    it('rejects malformed input', () => {
      assert.throws(() => parseDictionary('sig1=("a"'));
      assert.throws(() => parseDictionary('sig1=:AAEC'));
      assert.throws(() => parseDictionary('sig1=1 sig2=2'));
    });
  });

  describe('parseSignatureAgent', () => {
    it('reads a string, a dictionary by label, or a bare URL', () => {
      assert.strictEqual(parseSignatureAgent('"https://bot.example"'), agent);
      assert.strictEqual(
        parseSignatureAgent(
          'sig1="https://bot.example/", sig2="https://x.example"',
          'sig1'
        ),
        agent
      );
      assert.strictEqual(parseSignatureAgent('https://bot.example'), agent);
    });

    it('rejects anything but an https origin', () => {
      assert.strictEqual(parseSignatureAgent('"http://bot.example"'), null);
      assert.strictEqual(parseSignatureAgent('bot'), null);
      assert.strictEqual(
        parseSignatureAgent('sig1="https://x.example"', 'sig2'),
        null
      );
    });
  });

  describe('keys', () => {
    it('keeps Ed25519 keys by thumbprint, and skips the others', () => {
      const { jwk, keyid } = keyPair();
      const keys = keysFromJwks([jwk, { kty: 'RSA', n: 'x', e: 'AQAB' }, null]);
      assert.deepStrictEqual([...keys.keys()], [keyid]);
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

    it('rejects components that are not strings, without throwing', async () => {
      const request = signedRequest(pair);
      request.headers['signature-input'] =
        `sig1=(1 "@authority");keyid="${pair.keyid}";tag="web-bot-auth"`;
      assert.strictEqual((await check(request)).reason, 'malformed');
    });

    it('reports a missing agent and malformed headers', async () => {
      const request = signedRequest(pair);
      delete request.headers['signature-agent'];
      assert.strictEqual((await check(request)).reason, 'no agent');
      const malformed = signedRequest(pair);
      malformed.headers['signature-input'] = 'sig1=("@authority"';
      assert.strictEqual((await check(malformed)).reason, 'malformed');
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
          release = () =>
            resolve({
              ok: true,
              status: 200,
              headers: new Map(),
              json: async () => ({ keys: [rotated.jwk] }),
            });
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
