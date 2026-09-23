const assert = require('assert');

const { fromJS } = require('immutable');

const signature = require('../../src/modules/signature');

function log(address, id = 'sig-abc') {
  // signature.headers stays a plain object in real logs (see augment)
  return fromJS({
    request: { address },
    address: { value: address },
    executionTime: 1,
  }).set(
    'signature',
    fromJS({ id }).set('headers', { 'User-Agent': 'Bot/1.0' })
  );
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
    assert.strictEqual(formatted.addressCount, 3);
    assert.strictEqual(formatted.addresses, '1.2.3.4<br>5.6.7.8<br>9.9.9.9');
    assert.strictEqual(formatted.lastAddress, '9.9.9.9');
  });

  it('formats an entry without addresses', () => {
    aggregator.processLog(log('1.2.3.4'));
    const entry = aggregator.entries.first().delete('addresses');

    const formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.addressCount, 0);
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
    assert.strictEqual(formatted.addressCount, 1);
    assert.strictEqual(formatted.addresses, '5.6.7.8');
  });

  it('records the fingerprint score and sorts by it', () => {
    aggregator.processLog(
      log('1.2.3.4', 'sig-low').set('fingerprint', { score: 0.2, flags: [] })
    );
    aggregator.processLog(
      log('1.2.3.4', 'sig-high').set('fingerprint', { score: 0.8, flags: [] })
    );
    aggregator.processLog(log('1.2.3.4', 'sig-none'));

    const rows = aggregator.getData({ sort: 'score', format: 'json' }).toJS();
    assert.deepStrictEqual(
      rows.map((row) => [row.signature, row.score]),
      [
        ['sig-high', '0.8'],
        ['sig-low', '0.2'],
        ['sig-none', '—'],
      ]
    );
  });
});
