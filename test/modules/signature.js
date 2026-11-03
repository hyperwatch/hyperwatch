const assert = require('assert');

const { fromJS } = require('immutable');

const { now } = require('../../src/lib/util');
const signature = require('../../src/modules/signature');

// Logs only carry the signature id (see augment)
function log(address, id = 'sig-abc', headers = { 'user-agent': 'Bot/1.0' }) {
  return fromJS({
    request: { address, headers },
    address: { value: address },
    signature: { id },
    executionTime: 1,
  });
}

describe('signature aggregator', () => {
  let aggregator;

  before(() => {
    signature.start();
    aggregator = signature.aggregator;
  });

  beforeEach(() => aggregator.reset());

  it('lists distinct addresses and counts them', () => {
    aggregator.processLog(log('1.2.3.4'));
    aggregator.processLog(log('5.6.7.8'));
    aggregator.processLog(log('1.2.3.4'));
    aggregator.processLog(log('9.9.9.9'));

    const entry = aggregator.entries.first();
    const formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.addressCount24h, 3);
    assert.strictEqual(formatted.addresses, '1.2.3.4<br>5.6.7.8<br>9.9.9.9');
    assert.strictEqual(formatted.lastAddress, '9.9.9.9');
  });

  it('escapes headers in HTML output', () => {
    aggregator.processLog(
      log('1.2.3.4', 'sig-abc', { 'user-agent': '<script>' })
    );

    const formatted = aggregator.formatter.formatObject(
      aggregator.entries.first(),
      'html'
    );
    assert.strictEqual(formatted.headers, 'User-Agent:&lt;script&gt;');
  });

  it('keeps only the id in logs, and the headers once per signature', () => {
    const augmented = signature.augment(
      fromJS({
        request: {
          address: '1.2.3.4',
          headers: { accept: '*/*', 'user-agent': 'Bot/1.0', host: 'x' },
        },
      })
    );
    assert.deepStrictEqual(augmented.get('signature').toJS(), {
      id: augmented.getIn(['signature', 'id']),
    });

    aggregator.processLog(
      augmented.set('address', fromJS({ value: '1.2.3.4' }))
    );
    const entry = aggregator.entries.first();
    assert.deepStrictEqual(entry.getIn(['signature', 'headers']), {
      Accept: '*/*',
      'User-Agent': 'Bot/1.0',
    });
    const formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.headers, 'Accept:*/*<br>User-Agent:Bot/1.0');
  });

  it("keeps an entry's signature while its id doesn't change", () => {
    aggregator.processLog(log('1.2.3.4'));
    const first = aggregator.entries.first().get('signature');
    aggregator.processLog(log('5.6.7.8'));
    assert.strictEqual(aggregator.entries.first().get('signature'), first);
  });

  it('formats an entry without addresses', () => {
    aggregator.processLog(log('1.2.3.4'));
    const entry = aggregator.entries.first().delete('addresses');

    const formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.addressCount24h, 0);
    assert.strictEqual(formatted.addresses, '');
  });

  it('prunes stale addresses on gc', () => {
    aggregator.processLog(log('1.2.3.4'));
    aggregator.processLog(log('5.6.7.8'));
    const id = aggregator.entries.keySeq().first();
    aggregator.entries = aggregator.entries.setIn(
      [id, 'addresses', '1.2.3.4'],
      0
    );

    aggregator.gc();

    const formatted = aggregator.formatter.formatObject(
      aggregator.entries.get(id),
      'text'
    );
    assert.strictEqual(formatted.addressCount24h, 1);
    assert.strictEqual(formatted.addresses, '5.6.7.8');
  });

  it('counts addresses over 15m and 24h', () => {
    aggregator.processLog(log('1.2.3.4'));
    aggregator.processLog(log('5.6.7.8'));
    const id = aggregator.entries.keySeq().first();
    aggregator.entries = aggregator.entries.setIn(
      [id, 'addresses', '1.2.3.4'],
      now() - 3600
    );

    const formatted = aggregator.formatter.formatObject(
      aggregator.entries.get(id),
      'text'
    );
    assert.strictEqual(formatted.addressCount15m, 1);
    assert.strictEqual(formatted.addressCount24h, 2);
  });
});
