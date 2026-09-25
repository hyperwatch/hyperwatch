const assert = require('assert');

const { fromJS } = require('immutable');

const html = require('../../src/app/html');
const { now } = require('../../src/lib/util');
const address = require('../../src/modules/address');

function log(value, signatureId) {
  return fromJS({
    request: { address: value },
    address: { value },
    signature: { id: signatureId },
    executionTime: 1,
  });
}

describe('address aggregator', () => {
  let aggregator;

  before(() => {
    address.start();
    aggregator = address.aggregator;
  });

  beforeEach(() => aggregator.reset());

  it('starts with the address, lastIdentity after the hostname', () => {
    const keys = aggregator.formatter.formats.map(([key]) => key);
    assert.strictEqual(keys[0], 'address');
    assert.strictEqual(
      keys.indexOf('lastIdentity'),
      keys.indexOf('hostname') + 1
    );
    assert.ok(!keys.includes('identity'));
  });

  it('links addresses to their logs in HTML', () => {
    aggregator.processLog(log('1.2.3.4', 'sig-a'));
    const entry = aggregator.entries.first();
    const format = () => aggregator.formatter.formatObject(entry, 'html');

    html.registerSection('logs');
    assert.match(
      format().address,
      /<a href="logs\/main\?address=1\.2\.3\.4">1\.2\.3\.4<\/a>/
    );
    assert.strictEqual(
      aggregator.formatter.formatObject(entry, 'text').address,
      '1.2.3.4'
    );
  });

  it('counts distinct signatures over 15m and 24h', () => {
    aggregator.processLog(log('1.2.3.4', 'sig-a'));
    aggregator.processLog(log('1.2.3.4', 'sig-b'));
    aggregator.processLog(log('1.2.3.4', 'sig-a'));
    aggregator.processLog(log('1.2.3.4', 'sig-c'));

    const entry = aggregator.entries.first();
    let formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.signatureCount15m, 3);
    assert.strictEqual(formatted.signatureCount24h, 3);

    const id = aggregator.entries.keySeq().first();
    aggregator.entries = aggregator.entries.setIn(
      [id, 'signatures', 'sig-a'],
      now() - 3600
    );

    formatted = aggregator.formatter.formatObject(
      aggregator.entries.get(id),
      'text'
    );
    assert.strictEqual(formatted.signatureCount15m, 2);
    assert.strictEqual(formatted.signatureCount24h, 3);
  });

  it('formats an entry without signatures', () => {
    aggregator.processLog(log('1.2.3.4', 'sig-a'));
    const entry = aggregator.entries.first().delete('signatures');

    const formatted = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(formatted.signatureCount15m, 0);
    assert.strictEqual(formatted.signatureCount24h, 0);
  });

  it('sorts by the 15m signature count', () => {
    // 1.1.1.1: one signature, recent
    aggregator.processLog(log('1.1.1.1', 'sig-a'));
    // 2.2.2.2: three signatures, all an hour old
    aggregator.processLog(log('2.2.2.2', 'sig-a'));
    aggregator.processLog(log('2.2.2.2', 'sig-b'));
    aggregator.processLog(log('2.2.2.2', 'sig-c'));
    // 3.3.3.3: two signatures, recent
    aggregator.processLog(log('3.3.3.3', 'sig-a'));
    aggregator.processLog(log('3.3.3.3', 'sig-b'));

    const id = aggregator.entries.findKey(
      (entry) => entry.get('identifier') === '2.2.2.2'
    );
    aggregator.entries = aggregator.entries
      .setIn([id, 'signatures', 'sig-a'], now() - 3600)
      .setIn([id, 'signatures', 'sig-b'], now() - 3600)
      .setIn([id, 'signatures', 'sig-c'], now() - 3600);

    const order = (sort) =>
      aggregator
        .getData({ sort, raw: true })
        .map((entry) => entry.get('identifier'))
        .toArray();

    assert.deepStrictEqual(order('signatureCount15m'), [
      '3.3.3.3',
      '1.1.1.1',
      '2.2.2.2',
    ]);
    assert.strictEqual(order('signatureCount24h')[0], '2.2.2.2');
  });
});
