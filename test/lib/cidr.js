const assert = require('assert');

const {
  compileRanges,
  inRange,
  isValidAddress,
  isValidCidr,
  networkAddress,
  parseAddress,
  parseCidr,
} = require('../../src/lib/cidr');

describe('cidr', () => {
  describe('parseAddress', () => {
    it('parses IPv4 and IPv6 addresses', () => {
      assert.strictEqual(parseAddress('192.0.2.1').correctForm(), '192.0.2.1');
      assert.strictEqual(
        parseAddress('2001:DB8:0:0::1').correctForm(),
        '2001:db8::1'
      );
    });

    it('reads an IPv4-mapped IPv6 address as IPv4', () => {
      assert.strictEqual(
        parseAddress('::ffff:192.0.2.1').correctForm(),
        '192.0.2.1'
      );
      assert.strictEqual(
        parseAddress('::ffff:c000:201').correctForm(),
        '192.0.2.1'
      );
    });

    it('rejects invalid addresses, ranges and leading-zero octets', () => {
      for (const value of [
        '',
        'nope',
        '192.0.2',
        '192.0.2.256',
        '010.0.2.1',
        '192.0.2.0/24',
        '2001:db8::/32',
        undefined,
        null,
        42,
      ]) {
        assert.strictEqual(parseAddress(value), null, String(value));
        assert.strictEqual(isValidAddress(value), false, String(value));
      }
    });
  });

  describe('parseCidr', () => {
    it('parses IPv4 and IPv6 ranges', () => {
      assert.ok(isValidCidr('198.51.100.0/24'));
      assert.ok(isValidCidr('2001:db8::/32'));
      assert.ok(isValidCidr('10.0.0.0/08'));
    });

    it('rejects invalid ranges and bare addresses', () => {
      for (const value of [
        '198.51.100.0',
        '198.51.100.0/33',
        '2001:db8::/129',
        '198.51.100.0/',
        '/24',
        '198.51.100.0/24/1',
        'nope/8',
      ]) {
        assert.strictEqual(parseCidr(value), null, value);
        assert.strictEqual(isValidCidr(value), false, value);
      }
    });

    it('gives the network address of a range', () => {
      assert.strictEqual(networkAddress('10.1.2.3/8'), '10.0.0.0');
      assert.strictEqual(networkAddress('2001:db8::1/32'), '2001:db8::');
    });
  });

  describe('inRange', () => {
    const range4 = parseCidr('198.51.100.0/24');
    const range6 = parseCidr('2001:db8::/32');

    it('includes the first and last addresses of a range', () => {
      for (const address of [
        '198.51.100.0',
        '198.51.100.7',
        '198.51.100.255',
      ]) {
        assert.ok(inRange(range4, address), address);
      }
      assert.ok(!inRange(range4, '198.51.101.0'));
      assert.ok(inRange(range6, '2001:db8:ffff::1'));
      assert.ok(!inRange(range6, '2001:db9::1'));
    });

    it('never matches across families', () => {
      assert.ok(!inRange(parseCidr('0.0.0.0/0'), '2001:db8::1'));
      assert.ok(!inRange(parseCidr('::/0'), '198.51.100.7'));
    });

    it('matches an IPv4-mapped address against IPv4 ranges', () => {
      assert.ok(inRange(range4, '::ffff:198.51.100.7'));
    });

    it('rejects an invalid address', () => {
      assert.ok(!inRange(range4, 'nope'));
      assert.ok(!inRange(range4, undefined));
    });
  });

  describe('compileRanges', () => {
    const match = compileRanges([
      '198.51.100.0/24',
      '2001:db8::/32',
      '203.0.113.9',
    ]);

    it('returns the range containing the address, as written', () => {
      assert.strictEqual(match('198.51.100.7'), '198.51.100.0/24');
      assert.strictEqual(match('2001:db8::1'), '2001:db8::/32');
      assert.strictEqual(match('::ffff:198.51.100.7'), '198.51.100.0/24');
    });

    it('treats a bare address as a single host', () => {
      assert.strictEqual(match('203.0.113.9'), '203.0.113.9');
      assert.strictEqual(match('203.0.113.10'), null);
    });

    it('returns null outside the ranges or for an invalid address', () => {
      assert.strictEqual(match('192.0.2.1'), null);
      assert.strictEqual(match('nope'), null);
      assert.strictEqual(match(''), null);
    });

    it('rejects an invalid range at compile time', () => {
      assert.throws(() => compileRanges(['198.51.100.0/33']), /invalid CIDR/);
    });
  });
});
