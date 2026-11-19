const assert = require('assert');

const { fromJS } = require('immutable');

const forwardProxy = require('../../src/modules/forward-proxy');

describe('forward-proxy', () => {
  // In Zscaler's published egress ranges
  const egress = '159.254.250.1';
  const egress6 = '2a03:eec0:3900::1';

  // A CDN edge or other reverse proxy of the site
  const edge = '203.0.113.9';

  function request(value, xff) {
    return fromJS({
      request: {
        address: value,
        headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      },
      address: { value },
    });
  }

  it("marks a proxy's egress, and the address it forwards for", () => {
    for (const [value, xff, forwarded] of [
      // Behind a CDN, which appended the egress
      [egress, `198.51.100.7, ${egress}`, '198.51.100.7'],
      // Then the site's own proxies
      [egress, `198.51.100.7, ${egress}, ${edge}`, '198.51.100.7'],
      // Only the hop just before the egress: the earlier ones can be forged
      [egress, `1.2.3.4, 198.51.100.7, ${egress}`, '198.51.100.7'],
      [egress6, `2001:db8::7, ${egress6}`, '2001:db8::7'],
      // The egress written in another form
      [
        egress6,
        `2001:db8::7, 2a03:eec0:3900:0:0:0:0:1, ${edge}`,
        '2001:db8::7',
      ],
      // The proxy connected directly: its single entry, in canonical form
      [egress, '198.51.100.7', '198.51.100.7'],
      [egress6, '2001:DB8:0::7', '2001:db8::7'],
    ]) {
      const log = forwardProxy.augment(request(value, xff));
      assert.strictEqual(log.getIn(['address', 'value']), value);
      assert.strictEqual(log.getIn(['address', 'proxy']), 'Zscaler');
      assert.strictEqual(log.getIn(['address', 'forwarded']), forwarded, xff);
    }
  });

  it('reads nothing it cannot place', () => {
    for (const xff of [
      // A reverse proxy appended itself, not the egress
      `198.51.100.7, ${edge}`,
      // Several entries without the egress: not what the proxy writes
      '192.0.2.99, 198.51.100.7',
    ]) {
      const log = forwardProxy.augment(request(egress, xff));
      assert.strictEqual(log.getIn(['address', 'proxy']), 'Zscaler');
      assert.ok(!log.hasIn(['address', 'forwarded']), xff);
    }
  });

  it('marks an egress without a usable forwarded address', () => {
    for (const xff of [undefined, '', egress, `garbage, ${egress}`]) {
      const log = forwardProxy.augment(request(egress, xff));
      assert.strictEqual(log.getIn(['address', 'proxy']), 'Zscaler');
      assert.ok(!log.hasIn(['address', 'forwarded']), String(xff));
    }
  });

  it('ignores X-Forwarded-For from any other address', () => {
    const log = forwardProxy.augment(
      request('192.0.2.1', `198.51.100.7, ${egress}`)
    );
    assert.ok(!log.hasIn(['address', 'proxy']));
    assert.ok(!log.hasIn(['address', 'forwarded']));
  });

  it('reads the request address without the address module', () => {
    const log = forwardProxy.augment(
      request(egress, `198.51.100.7, ${egress}`).delete('address')
    );
    assert.strictEqual(log.getIn(['address', 'proxy']), 'Zscaler');
    assert.ok(!log.hasIn(['address', 'value']));
  });

  it('keeps a proxy set before', () => {
    const log = forwardProxy.augment(
      request(egress, `198.51.100.7, ${egress}`).setIn(
        ['address', 'proxy'],
        'Other'
      )
    );
    assert.strictEqual(log.getIn(['address', 'proxy']), 'Other');
    assert.ok(!log.hasIn(['address', 'forwarded']));
  });
});
