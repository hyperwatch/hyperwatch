const assert = require('assert');

const { fromJS } = require('immutable');

const aggregator = require('../../src/lib/aggregator');
const cache = require('../../src/lib/cache');
const dnsbl = require('../../src/modules/dnsbl');

// Spamhaus documents these as permanent test entries: 127.0.0.2 is always
// listed on XBL, 127.0.0.1 never is.
const LISTED_IP = '127.0.0.2';
const CLEAN_IP = '127.0.0.1';

function log({ address, requestAddress }) {
  return fromJS({
    request: { address: requestAddress },
    address: address ? { value: address } : undefined,
  });
}

describe('dnsbl', () => {
  beforeEach(() => cache.clear());

  describe('augment (stubbed lookup)', () => {
    const calls = [];

    beforeEach(() => {
      calls.length = 0;
      dnsbl.setLookup(async (ip, blacklist) => {
        calls.push([ip, blacklist]);
        return ip === LISTED_IP;
      });
    });

    afterEach(() => dnsbl.setLookup());

    it('flags a listed address', async () => {
      const result = await dnsbl.augment(log({ address: LISTED_IP }));
      assert.strictEqual(result.getIn(['dnsbl', 'xbl']), true);
      assert.deepStrictEqual(calls, [[LISTED_IP, 'xbl.spamhaus.org']]);
    });

    it('does not flag a clean address', async () => {
      const result = await dnsbl.augment(log({ address: CLEAN_IP }));
      assert.strictEqual(result.getIn(['dnsbl', 'xbl']), false);
    });

    it('falls back to the request address', async () => {
      const result = await dnsbl.augment(log({ requestAddress: LISTED_IP }));
      assert.strictEqual(result.getIn(['dnsbl', 'xbl']), true);
      assert.deepStrictEqual(calls, [[LISTED_IP, 'xbl.spamhaus.org']]);
    });

    it('caches lookups per address', async () => {
      await dnsbl.augment(log({ address: LISTED_IP }));
      await dnsbl.augment(log({ address: LISTED_IP }));
      await dnsbl.augment(log({ address: CLEAN_IP }));
      assert.strictEqual(calls.length, 2);
    });
  });

  describe('xblFormat', () => {
    it('formats for text and json output', () => {
      const listed = fromJS({ dnsbl: { xbl: true } });
      const clean = fromJS({ dnsbl: { xbl: false } });
      const unknown = fromJS({});
      assert.strictEqual(dnsbl.xblFormat(listed, 'text'), 'x');
      assert.strictEqual(dnsbl.xblFormat(clean, 'text'), '');
      assert.strictEqual(dnsbl.xblFormat(unknown, 'text'), '');
      assert.strictEqual(dnsbl.xblFormat(listed, 'json'), true);
      assert.strictEqual(dnsbl.xblFormat(clean, 'json'), false);
      assert.strictEqual(dnsbl.xblFormat(unknown, 'json'), false);
    });

    it('registers an xbl column after address', () => {
      const originalFormats = [...aggregator.defaultFormatter.formats];
      try {
        dnsbl.init();
        const keys = aggregator.defaultFormatter.formats.map(([key]) => key);
        assert.strictEqual(keys.indexOf('xbl'), keys.indexOf('address') + 1);
      } finally {
        aggregator.defaultFormatter.formats = originalFormats;
      }
    });
  });

  // Exercises the real `dnsbl` package against Spamhaus, so a dependency bump
  // that breaks the lookup API fails here rather than silently in production.
  // Set HYPERWATCH_SKIP_NETWORK_TESTS=1 to skip when offline.
  const describeLive = process.env.HYPERWATCH_SKIP_NETWORK_TESTS
    ? describe.skip
    : describe;

  describeLive('live lookup', function () {
    this.timeout(15000);

    it('resolves the Spamhaus test addresses', async () => {
      const listed = await dnsbl.augment(log({ address: LISTED_IP }));
      const clean = await dnsbl.augment(log({ address: CLEAN_IP }));
      assert.strictEqual(listed.getIn(['dnsbl', 'xbl']), true);
      assert.strictEqual(clean.getIn(['dnsbl', 'xbl']), false);
    });
  });
});
