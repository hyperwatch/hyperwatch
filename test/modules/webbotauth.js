const assert = require('assert');
const crypto = require('crypto');

const { fromJS } = require('immutable');

const constants = require('../../src/constants');
const { KeyStore, thumbprint } = require('../../src/lib/webbotauth');
const identity = require('../../src/modules/identity');
const webbotauth = require('../../src/modules/webbotauth');

const time = '2027-01-15T08:00:00.000Z';
const created = Date.parse(time) / 1000;

function keyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { jwk, privateKey, keyid: thumbprint(jwk) };
}

const exa = keyPair();
const river = keyPair();

// A log of a request signed by `agent` for `authority`, reaching `host`
function signedLog(
  { privateKey, keyid },
  { agent, authority = 'www.example.com', host = authority, family }
) {
  const params = `("@authority" "signature-agent");created=${created};expires=${created + 300};keyid="${keyid}";alg="ed25519";tag="web-bot-auth"`;
  const base = [
    `"@authority": ${authority}`,
    `"signature-agent": "${agent}"`,
    `"@signature-params": ${params}`,
  ].join('\n');
  const signature = crypto.sign(null, Buffer.from(base), privateKey);
  return fromJS({
    request: {
      time,
      method: 'GET',
      url: '/',
      address: '203.0.113.7',
      headers: {
        host,
        'signature-agent': `"${agent}"`,
        'signature-input': `sig1=${params}`,
        signature: `sig1=:${signature.toString('base64')}:`,
      },
    },
    address: { value: '203.0.113.7' },
    agent: { family },
    executionTime: 1,
  });
}

describe('webbotauth module', () => {
  const saved = { ...constants.modules.webbotauth };

  before(() => {
    webbotauth.setKeyStore(
      new KeyStore({
        agents: ['https://crawler.exa.ai', 'https://river.ai'],
        committed: {
          'https://crawler.exa.ai': [exa.jwk],
          'https://river.ai': [river.jwk],
        },
        fetchKeys: false,
      })
    );
  });

  afterEach(() => {
    constants.modules.webbotauth = { ...saved };
  });

  after(() => webbotauth.setKeyStore(undefined));

  describe('augment', () => {
    it('sets webbotauth on signed requests only', async () => {
      const log = await webbotauth.augment(
        signedLog(exa, { agent: 'https://crawler.exa.ai' })
      );
      assert.deepStrictEqual(log.get('webbotauth').toJS(), {
        agent: 'https://crawler.exa.ai',
        keyid: exa.keyid,
        verified: true,
        reason: 'verified',
      });
      const unsigned = fromJS({
        request: { time, method: 'GET', url: '/', headers: { host: 'a' } },
      });
      assert.strictEqual(await webbotauth.augment(unsigned), unsigned);
    });

    it('keeps the log when verification fails unexpectedly', async () => {
      constants.modules.webbotauth.authority = () => {
        throw new Error('broken config');
      };
      const log = await webbotauth.augment(
        signedLog(exa, { agent: 'https://crawler.exa.ai' })
      );
      assert.strictEqual(log.getIn(['webbotauth', 'reason']), 'error');
      assert.strictEqual(log.getIn(['webbotauth', 'verified']), false);
    });

    it("drops only the default port of the request's scheme", () => {
      const authorities = (host, scheme) =>
        webbotauth.authoritiesOf(
          fromJS({ request: { scheme, headers: { host } } })
        );
      assert.deepStrictEqual(authorities('www.example.com:443'), [
        'www.example.com',
      ]);
      assert.deepStrictEqual(authorities('www.example.com:80', 'http'), [
        'www.example.com',
      ]);
      assert.deepStrictEqual(authorities('www.example.com:80', 'https'), [
        'www.example.com:80',
      ]);
      assert.deepStrictEqual(authorities('www.example.com:443', 'http'), [
        'www.example.com:443',
      ]);
      assert.deepStrictEqual(authorities('www.example.com:8443'), [
        'www.example.com:8443',
      ]);
    });

    it('verifies behind a proxy with the public host of `authorities`', async () => {
      const log = signedLog(exa, {
        agent: 'https://crawler.exa.ai',
        host: 'internal.example',
      });
      assert.strictEqual(
        (await webbotauth.augment(log)).getIn(['webbotauth', 'reason']),
        'bad signature'
      );
      constants.modules.webbotauth.authorities = {
        'internal.example': 'www.example.com',
      };
      assert.strictEqual(
        (await webbotauth.augment(log)).getIn(['webbotauth', 'verified']),
        true
      );
    });

    it('takes the public hosts from an `authority` function too', () => {
      constants.modules.webbotauth.authority = (log) =>
        log.getIn(['request', 'headers', 'host']).startsWith('internal.example')
          ? ['www.example.com', 'example.com']
          : null;
      const log = signedLog(exa, {
        agent: 'https://crawler.exa.ai',
        host: 'internal.example:443',
      });
      assert.deepStrictEqual(webbotauth.authoritiesOf(log), [
        'www.example.com',
        'example.com',
        'internal.example',
      ]);
    });
  });

  describe('aggregator', () => {
    before(() => webbotauth.start());
    beforeEach(() => webbotauth.aggregator.reset());

    it('counts signed requests by agent and result', async () => {
      const { aggregator } = webbotauth;
      const good = await webbotauth.augment(
        signedLog(exa, { agent: 'https://crawler.exa.ai' })
      );
      const bad = await webbotauth.augment(
        signedLog(river, { agent: 'https://crawler.exa.ai' })
      );
      aggregator.processLog(good);
      aggregator.processLog(good);
      aggregator.processLog(bad);
      const rows = aggregator
        .getData({ sort: 'count15m', limit: 10, format: 'json' })
        .toJS()
        .map(({ domain, result, count15m }) => ({ domain, result, count15m }));
      assert.deepStrictEqual(rows, [
        { domain: 'crawler.exa.ai', result: 'verified', count15m: 2 },
        { domain: 'crawler.exa.ai', result: 'unknown key', count15m: 1 },
      ]);
    });
  });

  describe('identity', () => {
    const identityOf = async (log) =>
      identity.augment(await webbotauth.augment(log)).get('identity');

    it('identifies Exa only by a verified signature when the module is on', async () => {
      constants.modules.webbotauth.active = true;
      assert.strictEqual(
        await identityOf(
          signedLog(exa, {
            agent: 'https://crawler.exa.ai',
            family: 'ExaSearchBot',
          })
        ),
        'Exa'
      );
      // Signed with another key
      assert.strictEqual(
        await identityOf(
          signedLog(river, {
            agent: 'https://crawler.exa.ai',
            family: 'ExaSearchBot',
          })
        ),
        undefined
      );
      // The header alone, without a signature
      const headerOnly = fromJS({
        request: {
          time,
          headers: { 'signature-agent': '"https://crawler.exa.ai"' },
        },
        agent: { family: 'ExaSearchBot' },
      });
      assert.strictEqual(await identityOf(headerOnly), undefined);
    });

    it("keeps Exa's header check when the module is off", () => {
      constants.modules.webbotauth.active = false;
      const headerOnly = fromJS({
        request: {
          time,
          headers: { 'signature-agent': '"https://crawler.exa.ai"' },
        },
        agent: { family: 'ExaSearchBot' },
      });
      assert.strictEqual(identity.augment(headerOnly).get('identity'), 'Exa');
    });

    it('accepts a verified signature next to the other checks', async () => {
      assert.strictEqual(
        await identityOf(
          signedLog(river, { agent: 'https://river.ai', family: 'RiverBot' })
        ),
        'River'
      );
      // Another agent's verified signature proves nothing for River
      assert.strictEqual(
        await identityOf(
          signedLog(exa, {
            agent: 'https://crawler.exa.ai',
            family: 'RiverBot',
          })
        ),
        undefined
      );
    });
  });
});
