const assert = require('assert');

const { fromJS } = require('immutable');

const { now } = require('../../src/lib/util');
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
    assert.strictEqual(formatted.addressCount24h, 3);
    assert.strictEqual(formatted.addresses, '1.2.3.4<br>5.6.7.8<br>9.9.9.9');
    assert.strictEqual(formatted.lastAddress, '9.9.9.9');
  });

  it('shortens the HTML output', () => {
    for (const address of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      aggregator.processLog(log(address, 'b3c4d5e6f7a8b9c0'));
    }

    const entry = aggregator.entries.first();
    const formatted = aggregator.formatter.formatObject(entry, 'html');
    assert.strictEqual(
      formatted.signature,
      '<span title="b3c4d5e6f7a8b9c0">b3c4d5e6</span>'
    );
    assert.strictEqual(
      formatted.addresses,
      '1.1.1.1<br>2.2.2.2<br>3.3.3.3<br><span class="grey">+1 more</span>'
    );
  });

  it('escapes headers in HTML output', () => {
    const entry = log('1.2.3.4').setIn(['signature', 'headers'], {
      'User-Agent': '<script>',
    });
    aggregator.processLog(entry);

    const formatted = aggregator.formatter.formatObject(
      aggregator.entries.first(),
      'html'
    );
    assert.strictEqual(
      formatted.headers,
      '<span class="grey">User-Agent:</span> &lt;script&gt;'
    );
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
