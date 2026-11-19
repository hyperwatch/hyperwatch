const assert = require('assert');

const { dataChanges, refreshTitle } = require('../../scripts/lib/data-changes');
const { thumbprint } = require('../../src/lib/webbotauth');

const key = (x) => ({ kty: 'OKP', crv: 'Ed25519', x });
const a = key('11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo');
const b = key('X53rIypL6muU_xeVU6Vm0uoGQcKKxm5FCRIFZHR0CZA');

describe('data changes', () => {
  it('gives the ranges added and removed per list', () => {
    assert.strictEqual(
      dataChanges([
        {
          name: 'one-ips.json',
          before: ['192.0.2.0/24', '198.51.100.0/24'],
          after: ['192.0.2.0/24', '203.0.113.0/24'],
        },
        {
          name: 'same-ips.json',
          before: ['192.0.2.0/24'],
          after: ['192.0.2.0/24'],
        },
        { name: 'new-ips.json', before: null, after: ['2001:db8::/32'] },
      ]),
      [
        '| List | Change |',
        '|---|---|',
        '| `one-ips.json` | + `203.0.113.0/24`; − `198.51.100.0/24` |',
        '| `new-ips.json` | + `2001:db8::/32` |',
        '',
        'Some entries were removed: check them.',
        'The other fetched lists are unchanged.',
      ].join('\n')
    );
  });

  it('counts what it does not list', () => {
    const after = Array.from({ length: 12 }, (_, i) => `192.0.2.${i}/32`);
    const table = dataChanges([{ name: 'x-ips.json', before: [], after }]);
    assert.match(table, /`192\.0\.2\.9\/32` and 2 more \|/);
    assert.match(table, /Nothing was removed\./);
  });

  it('gives the keys added and removed per agent, by thumbprint', () => {
    assert.strictEqual(
      dataChanges([
        {
          name: 'webbotauth-keys.json',
          before: { 'https://a.example': [a], 'https://b.example': [b] },
          after: { 'https://a.example': [a, b], 'https://b.example': [b] },
        },
      ]).split('\n')[2],
      `| \`webbotauth-keys.json\` (\`https://a.example\`) | + key \`${thumbprint(
        b
      )}\` |`
    );
  });

  it('is null when nothing changed', () => {
    assert.strictEqual(
      dataChanges([{ name: 'x-ips.json', before: ['a'], after: ['a'] }]),
      null
    );
  });

  it('names the pull request after what changed', () => {
    assert.strictEqual(
      refreshTitle(['meta-ips.json']),
      'Refresh the published IP ranges'
    );
    assert.strictEqual(
      refreshTitle(['webbotauth-keys.json']),
      'Refresh the Web Bot Auth keys'
    );
    assert.strictEqual(
      refreshTitle(['meta-ips.json', 'webbotauth-keys.json']),
      'Refresh the published IP ranges and Web Bot Auth keys'
    );
  });
});
