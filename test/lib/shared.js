const assert = require('assert');

const { parse } = require('@hyperwatch/iptoasn');
const { fromJS, is } = require('immutable');

const { Aggregator } = require('../../src/lib/aggregator');
const LogBuffer = require('../../src/lib/log-buffer');
const {
  shared,
  sharedFromJS,
  sharedFields,
  sizes,
} = require('../../src/lib/shared');
const agent = require('../../src/modules/agent');
const asn = require('../../src/modules/asn');
const cloudflare = require('../../src/modules/cloudflare');
const language = require('../../src/modules/language');
const signature = require('../../src/modules/signature');

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

const request = (headers) => fromJS({ request: { headers } });

describe('shared', () => {
  it('gives the same value for the same field and key', () => {
    let builds = 0;
    const build = () => {
      builds++;
      return fromJS({ family: 'Chrome' });
    };
    const a = shared('test-a', 'chrome', build);
    const b = shared('test-a', 'chrome', build);
    assert.strictEqual(a, b);
    assert.strictEqual(builds, 1);
    assert.notStrictEqual(shared('test-b', 'chrome', build), a);
    assert.strictEqual(sizes()['test-a'], 1);
  });

  it('passes primitives through without keeping them', () => {
    assert.strictEqual(
      shared('test-c', 'x', () => 'x'),
      'x'
    );
    assert.strictEqual(sizes()['test-c'], 0);
  });

  it('shares values by their JSON content', () => {
    const a = sharedFromJS('test-d', { country: 'US' });
    const b = sharedFromJS('test-d', { country: 'US' });
    assert.strictEqual(a, b);
    assert.ok(is(a, fromJS({ country: 'US' })));
    assert.notStrictEqual(sharedFromJS('test-d', { country: 'FR' }), a);
    assert.strictEqual(sharedFromJS('test-d', null), null);
  });

  it('builds a value again once nothing uses it', async function () {
    if (typeof global.gc !== 'function') {
      this.skip();
    }
    shared('test-e', 'k', () => fromJS({ a: 1 }));
    // Collected, then the registry's callback runs
    for (let i = 0; i < 10 && sizes()['test-e']; i++) {
      global.gc();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.strictEqual(sizes()['test-e'], 0);
  });

  describe('sharedFields', () => {
    it('replaces the shared fields, and a signature with only its id', () => {
      const plain = {
        agent: { family: 'Chrome' },
        geoip: { country: 'US' },
        signature: { id: 'abc' },
        address: { value: '192.0.2.1' },
      };
      const a = sharedFields(plain);
      const b = sharedFields(JSON.parse(JSON.stringify(plain)));
      for (const field of ['agent', 'geoip', 'signature']) {
        assert.strictEqual(a[field], b[field], field);
      }
      // Unique per entry: left as it is
      assert.deepStrictEqual(a.address, { value: '192.0.2.1' });
      // The input isn't changed
      assert.deepStrictEqual(plain.agent, { family: 'Chrome' });
    });

    it('leaves a signature with its headers as it is', () => {
      const plain = { signature: { id: 'abc', headers: { Accept: '*/*' } } };
      assert.deepStrictEqual(sharedFields(plain).signature, plain.signature);
    });
  });

  describe('modules', () => {
    it('agent and language: one value per header', async () => {
      const headers = { 'user-agent': CHROME, 'accept-language': 'en-US,en' };
      const a = await agent.augment(request(headers));
      const b = await agent.augment(request(headers));
      assert.strictEqual(a.get('agent'), b.get('agent'));
      assert.strictEqual(a.getIn(['agent', 'family']), 'Chrome');

      const c = language.augment(request(headers));
      const d = language.augment(request(headers));
      assert.strictEqual(c.get('language'), d.get('language'));
      assert.strictEqual(c.getIn(['language', 0, 'code']), 'en');
    });

    it('cloudflare and signature: one value per data center and per id', () => {
      const headers = { 'cf-ray': 'a5ff54b9692b439b-IAD', accept: '*/*' };
      const a = cloudflare.augment(request(headers));
      const b = cloudflare.augment(request(headers));
      assert.strictEqual(a.get('cloudflare'), b.get('cloudflare'));
      assert.deepStrictEqual(a.get('cloudflare').toJS(), {
        'data-center': 'IAD',
      });

      const c = signature.augment(request(headers));
      const d = signature.augment(request(headers));
      assert.strictEqual(c.get('signature'), d.get('signature'));
      // A log that already has signature fields keeps them
      const e = signature.augment(
        request(headers).set('signature', fromJS({ other: 1 }))
      );
      assert.strictEqual(e.getIn(['signature', 'other']), 1);
      assert.strictEqual(
        e.getIn(['signature', 'id']),
        c.getIn(['signature', 'id'])
      );
    });

    it('asn: restored entries get the value live logs get', () => {
      asn.setTable(parse('8.8.8.0\t8.8.8.255\t15169\tUS\tGOOGLE - Google LLC'));
      try {
        const live = asn.lookup('8.8.8.8');
        const restored = sharedFields({ asn: live.toJS() }).asn;
        assert.strictEqual(restored, live);
      } finally {
        asn.setTable(null);
      }
    });
  });

  describe('restored data', () => {
    const plainLog = (address) => ({
      address: { value: address },
      agent: { family: 'Chrome', major: '150' },
      language: [{ code: 'en', region: 'US', quality: 1 }],
      geoip: { country: 'US' },
      executionTime: 10,
    });

    it('aggregator entries share their values', () => {
      const source = new Aggregator();
      source.processLog(fromJS(plainLog('192.0.2.1')));
      source.processLog(fromJS(plainLog('192.0.2.2')));
      const dumped = JSON.parse(JSON.stringify(source.dump()));

      const restored = new Aggregator();
      restored.load(dumped);
      const entries = restored.entries.valueSeq().toArray();
      assert.strictEqual(entries.length, 2);
      for (const field of ['agent', 'language', 'geoip']) {
        assert.strictEqual(entries[0].get(field), entries[1].get(field), field);
      }
      assert.deepStrictEqual(entries[0].get('agent').toJS(), {
        family: 'Chrome',
        major: '150',
      });
    });

    it('history logs share their values', () => {
      const buffer = new LogBuffer(10);
      buffer.load([plainLog('192.0.2.1'), plainLog('192.0.2.2')]);
      const [a, b] = buffer.toArray();
      assert.strictEqual(a.get('agent'), b.get('agent'));
      assert.notStrictEqual(a.get('address'), b.get('address'));
    });
  });
});
