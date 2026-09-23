const assert = require('assert');

const expression = require('../../../src/lib/cloudflare/expression');

const list = (type, values, extra = {}) => ({
  id: 'test',
  type,
  entries: values.map((value) => ({ value })),
  ...extra,
});

describe('cloudflare expression', () => {
  it('builds a sorted IP set', () => {
    assert.strictEqual(
      expression.build(list('ip', ['5.5.5.5', '10.0.0.0/8', '2001:db8::/32'])),
      '(ip.src in {10.0.0.0/8 2001:db8::/32 5.5.5.5})'
    );
  });

  it('builds user agent clauses with escaping', () => {
    assert.strictEqual(
      expression.build(list('user_agent', ['b', 'say "hi" \\o/'])),
      '(http.user_agent eq "b") or (http.user_agent eq "say \\"hi\\" \\\\o/")'
    );
    assert.strictEqual(
      expression.build(list('user_agent', ['Headless'], { match: 'contains' })),
      '(http.user_agent contains "Headless")'
    );
  });

  it('round-trips build and parse', () => {
    const cases = [
      list('ip', ['1.2.3.4', '10.0.0.0/8', '2001:db8::1']),
      list('user_agent', ['Mozilla/5.0 (X11) "quoted"', 'back\\slash', 'x']),
      list('user_agent', ['Headless', 'python-requests'], {
        match: 'contains',
      }),
    ];
    for (const l of cases) {
      const parsed = expression.parse(expression.build(l), l);
      assert.ok(parsed.ok, parsed.reason);
      assert.deepStrictEqual(
        parsed.values.sort(),
        l.entries.map((e) => e.value).sort()
      );
    }
  });

  it('parses whitespace variations Cloudflare may return', () => {
    const parsed = expression.parse('( ip.src in { 1.2.3.4  5.6.7.8 } )', {
      type: 'ip',
    });
    assert.deepStrictEqual(parsed, {
      ok: true,
      values: ['1.2.3.4', '5.6.7.8'],
    });
  });

  it('refuses expressions it did not build', () => {
    const foreign = [
      ['(ip.src in {1.2.3.4}) and not cf.client.bot', { type: 'ip' }],
      ['(ip.src in {1.2.3.4}) or (ip.src in {5.6.7.8})', { type: 'ip' }],
      ['(ip.src in $blocked)', { type: 'ip' }],
      [
        '(http.user_agent eq "a") and (http.host eq "b")',
        { type: 'user_agent' },
      ],
      ['(http.user_agent contains "a")', { type: 'user_agent', match: 'eq' }],
      ['(http.user_agent eq "unterminated)', { type: 'user_agent' }],
      [undefined, { type: 'ip' }],
    ];
    for (const [expr, l] of foreign) {
      assert.strictEqual(expression.parse(expr, l).ok, false, expr);
    }
  });

  it('enforces the length limit and non-empty lists', () => {
    const many = Array.from(
      { length: 400 },
      (_, i) => `10.0.${i >> 8}.${i & 255}`
    );
    assert.throws(
      () => expression.build(list('ip', many)),
      /over Cloudflare's 4096 limit/
    );
    assert.throws(() => expression.build(list('ip', [])), /is empty/);
  });
});
