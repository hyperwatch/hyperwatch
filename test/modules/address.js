const assert = require('assert');

const { fromJS } = require('immutable');

const html = require('../../src/app/html');
const aggregatorLib = require('../../src/lib/aggregator');
const { now } = require('../../src/lib/util');
const address = require('../../src/modules/address');
const { agentFormat } = require('../../src/modules/agent');

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
    // The agent column, as the agent module adds it, only for this aggregator
    const { defaultFormatter } = aggregatorLib;
    defaultFormatter.insertFormat('agent', agentFormat);
    try {
      address.start();
    } finally {
      defaultFormatter.formats = defaultFormatter.formats.filter(
        ([key]) => key !== 'agent'
      );
    }
    aggregator = address.aggregator;
  });

  beforeEach(() => aggregator.reset());

  it('starts with the address, lastIdentity after the hostname', () => {
    const keys = aggregator.formatter.formats.map(([key]) => key);
    assert.strictEqual(keys[0], 'address');
    assert.ok(keys.indexOf('lastIdentity') > keys.indexOf('hostname'));
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

  it('escapes text chosen by clients in HTML', () => {
    aggregator.processLog(log('1.2.3.4', 'sig-a'));
    // What clients choose: their hostname and user agent
    const entry = aggregator.entries
      .first()
      .setIn(['address', 'hostname'], 'x<img src=x>.example')
      .setIn(
        ['request', 'headers', 'user-agent'],
        'Evil<script>alert(1)</script>'
      );
    const row = Object.values(
      aggregator.formatter.formatObject(entry, 'html')
    ).join(' ');
    assert.doesNotMatch(row, /<script|<img/);
    // Without an identity, the agent stands in, in grey
    assert.match(
      row,
      /<span class="grey">Evil&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/span>/
    );
    assert.match(row, /x&lt;img src=x&gt;\.example/);
    // Text outputs keep the values as they are
    assert.strictEqual(
      aggregator.formatter.formatObject(entry, 'text').hostname,
      'x<img src=x>.example'
    );
  });

  it('colors the hostname, not the address', () => {
    assert.strictEqual(aggregator.formatter.colors.hostname, 'cyan');
    assert.ok(!aggregator.formatter.colors.address);
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

  it('counts the distinct addresses a gateway forwarded for', () => {
    const behind = (forwarded) =>
      fromJS({
        request: { address: '159.254.250.1' },
        address: {
          value: '159.254.250.1',
          proxy: 'Zscaler',
          forwarded,
        },
        executionTime: 1,
      });
    aggregator.processLog(behind('192.0.2.1'));
    aggregator.processLog(behind('192.0.2.2'));
    aggregator.processLog(behind('192.0.2.1'));
    aggregator.processLog(log('1.1.1.1', 'sig-a'));

    const entry = aggregator.entries.find(
      (e) => e.get('identifier') === '159.254.250.1'
    );
    const text = aggregator.formatter.formatObject(entry, 'text');
    assert.strictEqual(text.proxy, 'Zscaler');
    assert.strictEqual(text.forwardedCount24h, 2);
    assert.strictEqual(
      String(aggregator.formatter.formatObject(entry, 'html').proxy),
      'Zscaler <span class="grey">(2 behind)</span>'
    );
    const other = aggregator.entries.find(
      (e) => e.get('identifier') === '1.1.1.1'
    );
    assert.strictEqual(
      aggregator.formatter.formatObject(other, 'text').proxy,
      ''
    );
  });
});

describe('address fill', () => {
  // In Zscaler's published egress ranges
  const egress = '159.254.250.1';
  const egress6 = '2a03:eec0:3900::1';

  function request(value, xff) {
    return fromJS({
      request: {
        address: value,
        headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      },
    });
  }

  it('takes the address from the request', () => {
    const filled = address.fill(request('192.0.2.1'));
    assert.strictEqual(filled.getIn(['address', 'value']), '192.0.2.1');
    assert.ok(!filled.hasIn(['address', 'proxy']));
  });

  it('keeps an address set before', () => {
    const filled = address.fill(
      request('10.0.0.1').setIn(['address', 'value'], '192.0.2.1')
    );
    assert.strictEqual(filled.getIn(['address', 'value']), '192.0.2.1');
  });

  it("marks a gateway's egress, and the address it forwards for", () => {
    for (const [value, xff, forwarded] of [
      // Behind a CDN, which appends the egress
      [egress, `198.51.100.7, ${egress}`, '198.51.100.7'],
      // Then the site's own proxies
      [egress, `198.51.100.7, ${egress}, 203.0.113.9`, '198.51.100.7'],
      // The gateway connected directly
      [egress, '198.51.100.7', '198.51.100.7'],
      // Only the hop just before the egress: the earlier ones can be forged
      [egress, `1.2.3.4, 198.51.100.7, ${egress}`, '198.51.100.7'],
      [egress6, `2001:db8::7, ${egress6}`, '2001:db8::7'],
    ]) {
      const filled = address.fill(request(value, xff));
      assert.strictEqual(filled.getIn(['address', 'value']), value);
      assert.strictEqual(filled.getIn(['address', 'proxy']), 'Zscaler');
      assert.strictEqual(filled.getIn(['address', 'forwarded']), forwarded);
    }
  });

  it('marks an egress without a usable forwarded address', () => {
    for (const xff of [undefined, '', egress, `garbage, ${egress}`]) {
      const filled = address.fill(request(egress, xff));
      assert.strictEqual(filled.getIn(['address', 'proxy']), 'Zscaler');
      assert.ok(!filled.hasIn(['address', 'forwarded']), String(xff));
    }
  });

  it('ignores X-Forwarded-For from any other address', () => {
    const filled = address.fill(
      request('192.0.2.1', `198.51.100.7, ${egress}`)
    );
    assert.ok(!filled.hasIn(['address', 'proxy']));
    assert.ok(!filled.hasIn(['address', 'forwarded']));
  });
});
