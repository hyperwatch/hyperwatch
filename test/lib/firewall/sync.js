const assert = require('assert');

const expression = require('../../../src/lib/cloudflare/expression');
const { validate } = require('../../../src/lib/firewall/lists');
const sync = require('../../../src/lib/firewall/sync');

const RULE = 'rule-ips';

const firewall = (values, extra = {}) =>
  validate({
    lists: [
      {
        id: 'block-ips',
        type: 'ip',
        action: 'block',
        cloudflare: { rule_id: RULE },
        entries: values.map((value) => ({ value, reason: `local ${value}` })),
        ...extra,
      },
    ],
  });

const ipRule = (values, extra = {}) => ({
  id: RULE,
  version: '3',
  action: 'block',
  description: 'Block IP blacklist',
  enabled: true,
  expression: `(ip.src in {${values.join(' ')}})`,
  ...extra,
});

const state = (values) => ({
  lists: { 'block-ips': { rule_id: RULE, version: '2', values } },
});

// A fake Cloudflare zone holding one ruleset
function fakeCloudflare(rules) {
  const zone = { id: 'ruleset', rules: rules.map((r) => ({ ...r })) };
  const calls = [];
  return {
    zone,
    calls,
    client: {
      getEntrypoint: async () => JSON.parse(JSON.stringify(zone)),
      patchRule: async (rulesetId, ruleId, rule) => {
        calls.push({ rulesetId, ruleId, rule });
        const target = zone.rules.find((r) => r.id === ruleId);
        Object.assign(target, rule, {
          version: String(Number(target.version) + 1),
        });
        return JSON.parse(JSON.stringify(zone));
      },
    },
  };
}

const planOne = (data, rules, st = { lists: {} }, opts = {}) =>
  sync.plan({ data, state: st, ruleset: { id: 'ruleset', rules }, ...opts })[0];

describe('firewall sync', () => {
  describe('plan', () => {
    it('imports everything from Cloudflare on the first sync', () => {
      const item = planOne(firewall([]), [ipRule(['1.1.1.1', '2.2.2.2'])]);
      assert.deepStrictEqual(item.toLocal, {
        add: ['1.1.1.1', '2.2.2.2'],
        remove: [],
      });
      assert.deepStrictEqual(item.toRemote, { add: [], remove: [] });
      assert.strictEqual(item.patch, undefined);
      const imported = item.list.entries.find((e) => e.value === '1.1.1.1');
      assert.strictEqual(imported.source, 'cloudflare');
      assert.strictEqual(imported.reason, 'added in Cloudflare');
    });

    it('unions both sides on the first sync', () => {
      const item = planOne(firewall(['1.1.1.1', '3.3.3.3']), [
        ipRule(['1.1.1.1', '2.2.2.2']),
      ]);
      assert.deepStrictEqual(item.toLocal.add, ['2.2.2.2']);
      assert.deepStrictEqual(item.toRemote.add, ['3.3.3.3']);
      assert.strictEqual(
        item.patch.expression,
        '(ip.src in {1.1.1.1 2.2.2.2 3.3.3.3})'
      );
    });

    it('merges adds and removals from both sides against the base', () => {
      // base: 1, 2, 3
      // local: removed 2, added 4
      // remote: removed 3, added 5
      const item = planOne(
        firewall(['1.1.1.1', '3.3.3.3', '4.4.4.4']),
        [ipRule(['1.1.1.1', '2.2.2.2', '5.5.5.5'])],
        state(['1.1.1.1', '2.2.2.2', '3.3.3.3'])
      );
      assert.deepStrictEqual(item.values, ['1.1.1.1', '4.4.4.4', '5.5.5.5']);
      assert.deepStrictEqual(item.toRemote, {
        add: ['4.4.4.4'],
        remove: ['2.2.2.2'],
      });
      assert.deepStrictEqual(item.toLocal, {
        add: ['5.5.5.5'],
        remove: ['3.3.3.3'],
      });
    });

    it('treats the same value added on both sides as one add', () => {
      const item = planOne(
        firewall(['1.1.1.1', '9.9.9.9']),
        [ipRule(['1.1.1.1', '9.9.9.9'])],
        state(['1.1.1.1'])
      );
      assert.ok(!sync.hasChanges(item));
      assert.deepStrictEqual(item.values, ['1.1.1.1', '9.9.9.9']);
    });

    it('keeps local entry metadata', () => {
      const item = planOne(
        firewall(['1.1.1.1']),
        [ipRule(['1.1.1.1', '2.2.2.2'])],
        state(['1.1.1.1'])
      );
      const kept = item.list.entries.find((e) => e.value === '1.1.1.1');
      assert.strictEqual(kept.reason, 'local 1.1.1.1');
    });

    it('compares IPs in canonical form', () => {
      const item = planOne(
        firewall(['2001:db8::1']),
        [ipRule(['2001:DB8:0:0::1'])],
        state(['2001:db8::1'])
      );
      assert.ok(!sync.hasChanges(item));
    });

    it('ignores a base recorded for another rule', () => {
      const st = {
        lists: { 'block-ips': { rule_id: 'old', values: ['1.1.1.1'] } },
      };
      const item = planOne(firewall([]), [ipRule(['1.1.1.1'])], st);
      assert.deepStrictEqual(item.toLocal.add, ['1.1.1.1']);
    });

    it('refuses rules it cannot read or find', () => {
      const edited = planOne(firewall(['1.1.1.1']), [
        ipRule([], {
          expression: '(ip.src in {1.1.1.1}) and http.host eq "x"',
        }),
      ]);
      assert.match(edited.errors[0], /edited by hand/);
      const missing = planOne(firewall(['1.1.1.1']), []);
      assert.match(missing.errors[0], /not found/);
    });

    it('refuses to empty a rule', () => {
      const item = planOne(
        firewall([]),
        [ipRule(['1.1.1.1'])],
        state(['1.1.1.1'])
      );
      assert.match(item.errors[0], /empty/);
    });

    it('reports metadata conflicts until a side is preferred', () => {
      const rules = [ipRule(['1.1.1.1'], { action: 'managed_challenge' })];
      const data = firewall(['1.1.1.1']);
      const st = state(['1.1.1.1']);

      const blocked = planOne(data, rules, st);
      assert.deepStrictEqual(blocked.conflicts, [
        { field: 'action', local: 'block', remote: 'managed_challenge' },
      ]);
      assert.match(blocked.errors[0], /--prefer/);

      const local = planOne(data, rules, st, { prefer: 'local' });
      assert.strictEqual(local.patch.action, 'block');

      const remote = planOne(data, rules, st, { prefer: 'remote' });
      assert.strictEqual(remote.patch, undefined);
      assert.strictEqual(remote.list.action, 'challenge');
      assert.ok(remote.localChanged);
    });

    it('keeps the rule disabled and warns', () => {
      const item = planOne(
        firewall(['1.1.1.1', '2.2.2.2']),
        [ipRule(['1.1.1.1'], { enabled: false })],
        state(['1.1.1.1'])
      );
      assert.strictEqual(item.patch.enabled, false);
      assert.match(item.warnings[0], /disabled/);
    });

    it('syncs user agent lists', () => {
      const data = validate({
        lists: [
          {
            id: 'block-uas',
            type: 'user_agent',
            action: 'block',
            cloudflare: { rule_id: 'rule-uas' },
            entries: [{ value: 'Bad "Bot"' }],
          },
        ],
      });
      const rule = {
        id: 'rule-uas',
        version: '1',
        action: 'block',
        enabled: true,
        expression: '(http.user_agent eq "Other")',
      };
      const item = sync.plan({
        data,
        state: { lists: {} },
        ruleset: { rules: [rule] },
      })[0];
      assert.strictEqual(
        item.patch.expression,
        '(http.user_agent eq "Bad \\"Bot\\"") or (http.user_agent eq "Other")'
      );
    });
  });

  describe('apply', () => {
    function run(data, cf, st, { changedLocally = false } = {}) {
      const items = sync.plan({ data, state: st, ruleset: cf.zone });
      let written = null;
      return sync
        .apply(items, {
          client: cf.client,
          originalData: data,
          readData: () =>
            changedLocally
              ? firewall(['8.8.8.8'])
              : JSON.parse(JSON.stringify(data)),
          writeData: (next) => {
            written = next;
          },
          state: st,
        })
        .then((result) => ({ result, written, items }));
    }

    it('patches Cloudflare, then writes firewall.json and the state', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1', '5.5.5.5'])]);
      const st = state(['1.1.1.1']);
      const { result, written } = await run(
        firewall(['1.1.1.1', '4.4.4.4']),
        cf,
        st
      );

      assert.strictEqual(cf.calls.length, 1);
      assert.deepStrictEqual(cf.calls[0].rule, {
        expression: '(ip.src in {1.1.1.1 4.4.4.4 5.5.5.5})',
        action: 'block',
        description: 'Block IP blacklist',
        enabled: true,
      });
      assert.ok(result.localWritten);
      assert.deepStrictEqual(
        written.lists[0].entries.map((e) => e.value).sort(),
        ['1.1.1.1', '4.4.4.4', '5.5.5.5']
      );
      assert.deepStrictEqual(st.lists['block-ips'].values, [
        '1.1.1.1',
        '4.4.4.4',
        '5.5.5.5',
      ]);
      assert.strictEqual(st.lists['block-ips'].version, '4');
    });

    it('records the base even when nothing changed', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const st = { lists: {} };
      const { result } = await run(firewall(['1.1.1.1']), cf, st);
      assert.strictEqual(cf.calls.length, 0);
      assert.ok(result.localWritten);
      assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
    });

    it('skips a rule that changed since the plan', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const data = firewall(['1.1.1.1', '2.2.2.2']);
      const st = state(['1.1.1.1']);
      const items = sync.plan({ data, state: st, ruleset: cf.zone });
      cf.zone.rules[0].version = '9';
      await sync.apply(items, {
        client: cf.client,
        originalData: data,
        readData: () => data,
        writeData: () => assert.fail('should not write'),
        state: st,
      });
      assert.strictEqual(cf.calls.length, 0);
      assert.match(items[0].skipped, /changed since the plan/);
    });

    it('leaves firewall.json alone when it changed during the sync', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const st = state(['1.1.1.1']);
      const { result, written } = await run(
        firewall(['1.1.1.1', '2.2.2.2']),
        cf,
        st,
        { changedLocally: true }
      );
      assert.strictEqual(cf.calls.length, 1);
      assert.strictEqual(result.localWritten, false);
      assert.strictEqual(written, null);
      assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
    });

    it('does nothing for lists with errors', async () => {
      const cf = fakeCloudflare([
        ipRule([], { expression: '(ip.src in $list)' }),
      ]);
      const { result, items } = await run(firewall(['1.1.1.1']), cf, {
        lists: {},
      });
      assert.strictEqual(cf.calls.length, 0);
      assert.strictEqual(items[0].skipped, 'errors');
      assert.strictEqual(result.localWritten, false);
    });

    it('fails loudly if Cloudflare does not reflect the update', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      cf.client.patchRule = async () => JSON.parse(JSON.stringify(cf.zone));
      await assert.rejects(
        run(firewall(['1.1.1.1', '2.2.2.2']), cf, state(['1.1.1.1'])),
        /doesn't show the new expression/
      );
    });
  });

  it('parses what it builds for the state it records', () => {
    const data = firewall(['10.0.0.0/8', '1.1.1.1']);
    const built = expression.build(data.lists[0]);
    assert.ok(expression.parse(built, data.lists[0]).ok);
  });
});
