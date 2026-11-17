const assert = require('assert');

const { parse } = require('@hyperwatch/iptoasn');
const { fromJS } = require('immutable');

const asn = require('../../src/modules/asn');

const TSV = [
  '8.8.8.0\t8.8.8.255\t15169\tUS\tGOOGLE - Google LLC',
  '2001:4860::\t2001:4860:ffff:ffff:ffff:ffff:ffff:ffff\t15169\tUS\tGOOGLE - Google LLC',
].join('\n');

/**
 * @param {{ address?: string, requestAddress?: string }} options
 */
function log({ address, requestAddress }) {
  return fromJS({
    request: { address: requestAddress },
    address: address ? { value: address } : undefined,
  });
}

describe('asn', () => {
  afterEach(() => asn.setTable(null));

  describe('augment', () => {
    beforeEach(() => asn.setTable(parse(TSV)));

    it('sets asn on logs of known addresses', () => {
      const result = asn.augment(log({ address: '8.8.8.8' }));
      assert.deepStrictEqual(result.get('asn').toJS(), {
        number: 15169,
        organization: 'GOOGLE - Google LLC',
        country: 'US',
      });
    });

    it('falls back to the request address', () => {
      const result = asn.augment(log({ requestAddress: '2001:4860::1' }));
      assert.strictEqual(result.getIn(['asn', 'number']), 15169);
    });

    it('sets nothing for unknown addresses', () => {
      for (const address of ['10.0.0.1', '::1', 'nope']) {
        assert.strictEqual(asn.augment(log({ address })).has('asn'), false);
      }
      assert.strictEqual(asn.augment(log({})).has('asn'), false);
    });

    it('sets nothing without a table', () => {
      asn.setTable(null);
      assert.strictEqual(
        asn.augment(log({ address: '8.8.8.8' })).has('asn'),
        false
      );
    });

    it('caches per address, one value per range', () => {
      const table = parse(TSV);
      let finds = 0;
      const find = table.find.bind(table);
      table.find = (address) => {
        finds++;
        return find(address);
      };
      asn.setTable(table);
      const a = asn.lookup('8.8.8.8');
      const b = asn.lookup('8.8.8.8');
      const c = asn.lookup('8.8.8.9');
      asn.lookup('10.0.0.1');
      asn.lookup('10.0.0.1');
      assert.strictEqual(finds, 3);
      assert.strictEqual(a, b);
      assert.strictEqual(a, c);
    });
  });

  describe('load', () => {
    it('loads the table of @hyperwatch/iptoasn', async () => {
      await asn.load();
      assert.strictEqual(asn.lookup('8.8.8.8').get('number'), 15169);
      assert.strictEqual(
        asn.lookup('2606:4700:4700::1111').get('number'),
        13335
      );
      assert.strictEqual(asn.lookup('10.0.0.1'), null);
    });

    it('does nothing without @hyperwatch/iptoasn', async () => {
      const warn = console.warn;
      const warnings = [];
      console.warn = (message) => warnings.push(message);
      try {
        await asn.load(() => {
          const err = new Error("Cannot find module '@hyperwatch/iptoasn'");
          err.code = 'MODULE_NOT_FOUND';
          throw err;
        });
      } finally {
        console.warn = warn;
      }
      assert.match(warnings[0], /npm install @hyperwatch\/iptoasn/);
      assert.strictEqual(asn.lookup('8.8.8.8'), null);
    });
  });

  describe('aggregator', () => {
    before(async () => {
      asn.start();
      await asn.ready();
    });

    beforeEach(() => asn.aggregator.reset());

    it('counts distinct addresses, without the address module too', () => {
      for (const address of ['8.8.8.8', '8.8.4.4', '8.8.8.8']) {
        // As an input gives it: request.address, no address.value
        asn.aggregator.processLog(
          asn.augment(log({ requestAddress: address }))
        );
      }
      asn.aggregator.processLog(asn.augment(log({ address: '8.8.4.8' })));
      const entry = asn.aggregator.entries.first();
      const row = asn.aggregator.formatter.formatObject(entry, 'text');
      assert.strictEqual(row.asn, 'AS15169');
      assert.strictEqual(row.addressCount24h, 3);
    });
  });
});
