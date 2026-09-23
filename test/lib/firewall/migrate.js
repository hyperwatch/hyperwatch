const assert = require('assert');

const { migrate } = require('../../../src/lib/firewall/migrate');

// Shaped like the rule-based firewall.json used by watch
const legacyFile = {
  rules: [
    {
      id: 'cf-block-access-rule-ips',
      action: 'block',
      reason: 'IP blacklist',
      match: {
        addresses: ['1.1.1.1', '2001:DB8::1'],
        address_dates: { '1.1.1.1': '2025-10-10' },
      },
      cloudflare: {
        type: 'custom_rule',
        id: 'c7fdacfb7ae3498a9d268e9117b3f8eb',
      },
    },
    {
      id: 'cf-block-user-agents',
      action: 'block',
      match: { user_agents: ['BadBot/1.0'] },
      cloudflare: {
        type: 'custom_rule',
        id: '82ff1b04a24442bc9cd8d1c91be97fb1',
      },
    },
    {
      id: 'cf-challenge-user-agents',
      action: 'monitor',
      match: { user_agents: ['Old/1.0'] },
      cloudflare: {
        type: 'custom_rule',
        id: '45b7c00748d04d16b213d0dac77f536e',
        action: 'managed_challenge',
      },
    },
    {
      id: 'block-address-3.3.3.3',
      action: 'block',
      type: 'address',
      match: { address: '3.3.3.3' },
      reason: 'spam',
      created: '2026-02-28',
      createdBy: 'dashboard',
    },
    {
      id: 'monitor-address-4.4.4.4',
      action: 'monitor',
      type: 'address',
      match: { address: '4.4.4.4' },
      createdBy: 'dashboard',
    },
    {
      id: 'broken',
      action: 'block',
      match: { address: 'not-an-ip' },
    },
    { id: 'sig', action: 'block', match: { signature: 'abc' } },
    {
      id: 'headless',
      action: 'block',
      match: { headers: { accept: '*/*' }, no_identity: true },
      cloudflare: { type: 'custom_rule', id: 'ffff' },
    },
    { id: 'regex', action: 'block', match: { ua_regex: 'curl/.*' } },
  ],
};

describe('firewall migrate', () => {
  const { firewall, legacy, report } = migrate(legacyFile);
  const byId = Object.fromEntries(firewall.lists.map((l) => [l.id, l]));

  it('turns Cloudflare-linked IP and UA rules into linked lists', () => {
    assert.deepStrictEqual(byId['block-ips'].cloudflare, {
      rule_id: 'c7fdacfb7ae3498a9d268e9117b3f8eb',
    });
    assert.deepStrictEqual(byId['block-ips'].entries, [
      { value: '1.1.1.1', added: '2025-10-10' },
      { value: '2001:db8::1' },
    ]);
    assert.strictEqual(byId['block-ips'].note, 'IP blacklist');
    assert.deepStrictEqual(
      byId['block-user-agents'].entries.map((e) => e.value),
      ['BadBot/1.0']
    );
    assert.strictEqual(byId['block-user-agents'].match, 'eq');
  });

  it('uses the action Cloudflare enforces', () => {
    const list = byId['challenge-user-agents'];
    assert.strictEqual(list.action, 'challenge');
    assert.strictEqual(
      list.cloudflare.rule_id,
      '45b7c00748d04d16b213d0dac77f536e'
    );
  });

  it('keeps unlinked IP rules as local lists with their metadata', () => {
    assert.deepStrictEqual(byId['block-ips-local'].entries, [
      {
        value: '3.3.3.3',
        reason: 'spam',
        added: '2026-02-28',
        source: 'dashboard',
      },
    ]);
    assert.strictEqual(byId['block-ips-local'].cloudflare, undefined);
    assert.deepStrictEqual(
      byId['monitor-ips-local'].entries.map((e) => e.value),
      ['4.4.4.4']
    );
  });

  it('backs up everything else untouched', () => {
    assert.deepStrictEqual(
      legacy.rules.map((r) => r.id),
      ['sig', 'headless', 'regex']
    );
    assert.deepStrictEqual(legacy.rules[1], legacyFile.rules[7]);
    assert.deepStrictEqual(legacy.invalid_values, [
      { rule: 'broken', value: 'not-an-ip', error: 'invalid IP "not-an-ip"' },
    ]);
    assert.deepStrictEqual(report.legacy, {
      signature: 1,
      'headers+no_identity': 1,
      ua_regex: 1,
      'invalid values': 1,
    });
  });
});
