const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

const lists = require('../../../src/lib/firewall/lists');

const ipList = (entries, extra = {}) => ({
  id: 'block-ips',
  type: 'ip',
  action: 'block',
  entries: entries.map((value) => ({ value })),
  ...extra,
});

const uaList = (entries, extra = {}) => ({
  id: 'block-uas',
  type: 'user_agent',
  action: 'block',
  entries: entries.map((value) => ({ value })),
  ...extra,
});

const log = ({ address, ua }) =>
  fromJS({
    address: address ? { value: address } : undefined,
    request: { headers: ua ? { 'user-agent': ua } : {} },
  });

describe('firewall lists', () => {
  describe('validate', () => {
    it('canonicalizes IPv6 addresses and CIDRs', () => {
      const data = lists.validate({
        lists: [ipList(['2001:DB8:0:0::1', '2001:db8:0::/32', '10.0.0.0/8'])],
      });
      assert.deepStrictEqual(
        data.lists[0].entries.map((e) => e.value),
        ['2001:db8::1', '2001:db8::/32', '10.0.0.0/8']
      );
    });

    it('rejects invalid values, host bits and duplicates', () => {
      const bad = [
        [ipList(['not-an-ip']), /invalid IP/],
        [ipList(['10.0.0.1/8']), /host bits set, did you mean "10.0.0.0\/8"/],
        [ipList(['1.2.3.4', '1.2.3.4']), /duplicate entry/],
        [ipList(['2001:db8::1', '2001:DB8::1']), /duplicate entry/],
        [uaList(['bad\nua']), /invalid user agent/],
      ];
      for (const [list, error] of bad) {
        assert.throws(() => lists.validate({ lists: [list] }), error);
      }
    });

    it('rejects bad list definitions', () => {
      const bad = [
        [{ lists: {} }, /"lists" array/],
        [{ lists: [ipList([]), ipList([])] }, /duplicate id/],
        [{ lists: [ipList([], { type: 'asn' })] }, /"type" must be/],
        [{ lists: [ipList([], { action: 'allow' })] }, /"action" must be/],
        [{ lists: [uaList([], { match: 'regex' })] }, /"match" must be/],
        [{ lists: [ipList([], { cloudflare: {} })] }, /rule_id/],
        [
          {
            lists: [
              ipList([], { action: 'monitor', cloudflare: { rule_id: 'x' } }),
            ],
          },
          /can't be linked to Cloudflare/,
        ],
      ];
      for (const [data, error] of bad) {
        assert.throws(() => lists.validate(data), error);
      }
    });
  });

  describe('compile', () => {
    const match = lists.compile(
      lists.validate({
        lists: [
          ipList(['1.2.3.4', '10.0.0.0/8', '2001:db8::/32']),
          uaList(['BadBot/1.0']),
          {
            id: 'watch-uas',
            type: 'user_agent',
            match: 'contains',
            action: 'monitor',
            entries: [{ value: 'HeadlessChrome' }],
          },
        ],
      })
    );

    it('matches exact IPs, IPv4 and IPv6 CIDRs', () => {
      assert.deepStrictEqual(match(log({ address: '1.2.3.4' })), {
        list: 'block-ips',
        action: 'block',
        value: '1.2.3.4',
      });
      assert.strictEqual(
        match(log({ address: '10.9.8.7' })).value,
        '10.0.0.0/8'
      );
      assert.strictEqual(
        match(log({ address: '2001:DB8::abcd' })).value,
        '2001:db8::/32'
      );
      assert.strictEqual(match(log({ address: '11.0.0.1' })), null);
    });

    it('falls back to request.address', () => {
      const entry = fromJS({ request: { address: '1.2.3.4', headers: {} } });
      assert.strictEqual(match(entry).list, 'block-ips');
    });

    it('matches user agents exactly or by substring', () => {
      assert.strictEqual(match(log({ ua: 'BadBot/1.0' })).list, 'block-uas');
      assert.strictEqual(match(log({ ua: 'BadBot/1.0 extra' })), null);
      const contains = match(log({ ua: 'Mozilla/5.0 HeadlessChrome/120' }));
      assert.deepStrictEqual(contains, {
        list: 'watch-uas',
        action: 'monitor',
        value: 'HeadlessChrome',
      });
    });

    it('finds the user agent whatever the header case', () => {
      const entry = fromJS({
        request: { headers: { 'User-Agent': 'BadBot/1.0' } },
      });
      assert.strictEqual(match(entry).list, 'block-uas');
    });

    it('returns the first matching list', () => {
      assert.strictEqual(
        match(log({ address: '1.2.3.4', ua: 'BadBot/1.0' })).list,
        'block-ips'
      );
    });
  });

  describe('addEntry / removeEntry', () => {
    const data = lists.validate({ lists: [ipList(['1.2.3.4'])] });

    it('adds a canonical entry once', () => {
      const next = lists.addEntry(data, 'block-ips', {
        value: '2001:DB8::1',
        reason: 'spam',
        source: 'dashboard',
      });
      const entry = next.lists[0].entries[1];
      assert.strictEqual(entry.value, '2001:db8::1');
      assert.strictEqual(entry.reason, 'spam');
      assert.strictEqual(entry.source, 'dashboard');
      assert.match(entry.added, /^\d{4}-\d{2}-\d{2}$/);
      assert.strictEqual(
        lists.addEntry(next, 'block-ips', { value: '1.2.3.4' }),
        next
      );
      assert.strictEqual(data.lists[0].entries.length, 1);
    });

    it('removes an entry', () => {
      const next = lists.removeEntry(data, 'block-ips', '1.2.3.4');
      assert.strictEqual(next.lists[0].entries.length, 0);
    });

    it('rejects unknown lists and invalid values', () => {
      assert.throws(
        () => lists.addEntry(data, 'nope', { value: '1.2.3.4' }),
        /unknown list/
      );
      assert.throws(
        () => lists.addEntry(data, 'block-ips', { value: 'x' }),
        /invalid IP/
      );
    });
  });

  describe('save / load', () => {
    it('writes sorted entries atomically and reads them back', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-'));
      const file = path.join(dir, 'firewall.json');
      lists.save(file, { lists: [ipList(['5.5.5.5', '1.1.1.1'])] });
      assert.ok(!fs.existsSync(`${file}.tmp`));
      const data = lists.load(file);
      assert.deepStrictEqual(
        data.lists[0].entries.map((e) => e.value),
        ['1.1.1.1', '5.5.5.5']
      );
      fs.rmSync(dir, { recursive: true });
    });

    it('refuses to save invalid data', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firewall-'));
      const file = path.join(dir, 'firewall.json');
      assert.throws(() => lists.save(file, { lists: [ipList(['x'])] }));
      assert.ok(!fs.existsSync(file));
      fs.rmSync(dir, { recursive: true });
    });
  });
});
