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

const planOne = (data, rules, st = { lists: {} }, direction = 'down') =>
  sync.plan({
    data,
    state: st,
    ruleset: { id: 'ruleset', rules },
    direction,
  })[0];

const values = (data) => data.lists[0].entries.map((e) => e.value).sort();

describe('firewall sync', () => {
  describe('plan', () => {
    it('needs a direction', () => {
      assert.throws(
        () => planOne(firewall([]), [ipRule(['1.1.1.1'])], undefined, 'both'),
        /"up" or "down"/
      );
    });

    it('down imports everything from Cloudflare on the first sync', () => {
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

    it('goes one way only on the first sync', () => {
      const data = firewall(['1.1.1.1', '3.3.3.3']);
      const rules = [ipRule(['1.1.1.1', '2.2.2.2'])];

      const down = planOne(data, rules, undefined, 'down');
      assert.deepStrictEqual(down.toLocal.add, ['2.2.2.2']);
      assert.strictEqual(down.patch, undefined);
      assert.deepStrictEqual(down.values, ['1.1.1.1', '2.2.2.2']);

      const up = planOne(data, rules, undefined, 'up');
      assert.deepStrictEqual(up.toRemote.add, ['3.3.3.3']);
      assert.strictEqual(up.list, undefined);
      assert.strictEqual(
        up.patch.expression,
        '(ip.src in {1.1.1.1 2.2.2.2 3.3.3.3})'
      );
      assert.deepStrictEqual(up.values, ['1.1.1.1', '3.3.3.3']);
    });

    it('down then up merges both sides against the base', () => {
      // base: 1, 2, 3
      // local: removed 2, added 4
      // remote: removed 3, added 5
      const st = state(['1.1.1.1', '2.2.2.2', '3.3.3.3']);
      const rule = ipRule(['1.1.1.1', '2.2.2.2', '5.5.5.5']);

      const down = planOne(
        firewall(['1.1.1.1', '3.3.3.3', '4.4.4.4']),
        [rule],
        st,
        'down'
      );
      assert.deepStrictEqual(down.toLocal, {
        add: ['5.5.5.5'],
        remove: ['3.3.3.3'],
      });
      assert.deepStrictEqual(values({ lists: [down.list] }), [
        '1.1.1.1',
        '4.4.4.4',
        '5.5.5.5',
      ]);

      const up = planOne(
        { lists: [down.list] },
        [rule],
        state(down.values),
        'up'
      );
      assert.deepStrictEqual(up.toRemote, {
        add: ['4.4.4.4'],
        remove: ['2.2.2.2'],
      });
      assert.strictEqual(
        up.patch.expression,
        '(ip.src in {1.1.1.1 4.4.4.4 5.5.5.5})'
      );
    });

    it("never undoes the other side's pending changes", () => {
      // Local removed 2 since the base: down keeps it removed, up removes it
      const removedLocally = [
        firewall(['1.1.1.1']),
        [ipRule(['1.1.1.1', '2.2.2.2'])],
        state(['1.1.1.1', '2.2.2.2']),
      ];
      assert.ok(!sync.hasChanges(planOne(...removedLocally, 'down')));
      assert.deepStrictEqual(planOne(...removedLocally, 'up').toRemote, {
        add: [],
        remove: ['2.2.2.2'],
      });

      // Cloudflare added 5 since the base: up leaves it, down imports it
      const addedRemotely = [
        firewall(['1.1.1.1']),
        [ipRule(['1.1.1.1', '5.5.5.5'])],
        state(['1.1.1.1']),
      ];
      const up = planOne(...addedRemotely, 'up');
      assert.ok(!sync.hasChanges(up));
      assert.deepStrictEqual(up.values, ['1.1.1.1']);
      assert.deepStrictEqual(planOne(...addedRemotely, 'down').toLocal.add, [
        '5.5.5.5',
      ]);
    });

    it('treats the same value added on both sides as one add', () => {
      for (const direction of ['up', 'down']) {
        const item = planOne(
          firewall(['1.1.1.1', '9.9.9.9']),
          [ipRule(['1.1.1.1', '9.9.9.9'])],
          state(['1.1.1.1']),
          direction
        );
        assert.ok(!sync.hasChanges(item));
        assert.deepStrictEqual(item.values, ['1.1.1.1', '9.9.9.9']);
      }
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

    it('refuses to empty a rule going up, but empties a list going down', () => {
      const up = planOne(
        firewall([]),
        [ipRule(['1.1.1.1'])],
        state(['1.1.1.1']),
        'up'
      );
      assert.match(up.errors[0], /empty/);

      const down = planOne(
        firewall(['1.1.1.1']),
        [ipRule(['2.2.2.2'])],
        state(['1.1.1.1', '2.2.2.2']),
        'down'
      );
      assert.deepStrictEqual(down.errors, []);
      assert.deepStrictEqual(down.list.entries, []);
    });

    it('takes metadata from the side it syncs from', () => {
      const rules = [ipRule(['1.1.1.1'], { action: 'managed_challenge' })];
      const data = firewall(['1.1.1.1'], { description: 'Local name' });
      const st = state(['1.1.1.1']);

      const down = planOne(data, rules, st, 'down');
      assert.deepStrictEqual(down.conflicts, [
        { field: 'action', local: 'block', remote: 'managed_challenge' },
        {
          field: 'description',
          local: 'Local name',
          remote: 'Block IP blacklist',
        },
      ]);
      assert.strictEqual(down.patch, undefined);
      assert.strictEqual(down.list.action, 'challenge');
      assert.strictEqual(down.list.description, 'Block IP blacklist');
      assert.ok(down.localChanged);

      const up = planOne(data, rules, st, 'up');
      assert.strictEqual(up.patch.action, 'block');
      assert.strictEqual(up.patch.description, 'Local name');
      assert.strictEqual(up.patch.expression, '(ip.src in {1.1.1.1})');
    });

    it('refuses a Cloudflare action lists cannot hold going down', () => {
      const item = planOne(firewall(['1.1.1.1']), [
        ipRule(['1.1.1.1'], { action: 'log' }),
      ]);
      assert.match(item.errors[0], /no firewall list equivalent/);
    });

    it('keeps the rule disabled and warns', () => {
      const item = planOne(
        firewall(['1.1.1.1', '2.2.2.2']),
        [ipRule(['1.1.1.1'], { enabled: false })],
        state(['1.1.1.1']),
        'up'
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
        direction: 'up',
      })[0];
      assert.strictEqual(
        item.patch.expression,
        '(http.user_agent eq "Bad \\"Bot\\"") or (http.user_agent eq "Other")'
      );
    });
  });

  describe('apply', () => {
    function run(data, cf, st, direction, { changedLocally = false } = {}) {
      const items = sync.plan({ data, state: st, ruleset: cf.zone, direction });
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

    it('up patches Cloudflare and records the local values', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1', '5.5.5.5'])]);
      const st = state(['1.1.1.1']);
      const { result, written } = await run(
        firewall(['1.1.1.1', '4.4.4.4']),
        cf,
        st,
        'up'
      );

      assert.strictEqual(cf.calls.length, 1);
      assert.deepStrictEqual(cf.calls[0].rule, {
        expression: '(ip.src in {1.1.1.1 4.4.4.4 5.5.5.5})',
        action: 'block',
        description: 'Block IP blacklist',
        enabled: true,
      });
      assert.strictEqual(result.localWritten, false);
      assert.strictEqual(written, null);
      assert.deepStrictEqual(st.lists['block-ips'].values, [
        '1.1.1.1',
        '4.4.4.4',
      ]);
      assert.strictEqual(st.lists['block-ips'].version, '4');
    });

    it('down writes firewall.json and records the Cloudflare values', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1', '5.5.5.5'])]);
      const st = state(['1.1.1.1']);
      const { result, written } = await run(
        firewall(['1.1.1.1', '4.4.4.4']),
        cf,
        st,
        'down'
      );

      assert.strictEqual(cf.calls.length, 0);
      assert.ok(result.localWritten);
      assert.deepStrictEqual(values(written), [
        '1.1.1.1',
        '4.4.4.4',
        '5.5.5.5',
      ]);
      assert.deepStrictEqual(st.lists['block-ips'].values, [
        '1.1.1.1',
        '5.5.5.5',
      ]);
      assert.strictEqual(st.lists['block-ips'].version, '3');
    });

    it('records the base even when nothing changed', async () => {
      for (const direction of ['up', 'down']) {
        const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
        const st = { lists: {} };
        const { result } = await run(firewall(['1.1.1.1']), cf, st, direction);
        assert.strictEqual(cf.calls.length, 0);
        assert.strictEqual(result.localWritten, false);
        assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
      }
    });

    it('skips a rule that changed since the plan', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const data = firewall(['1.1.1.1', '2.2.2.2']);
      const st = state(['1.1.1.1']);
      const items = sync.plan({
        data,
        state: st,
        ruleset: cf.zone,
        direction: 'up',
      });
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
      assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
    });

    it('down leaves firewall.json alone when it changed during the sync', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1', '2.2.2.2'])]);
      const st = state(['1.1.1.1']);
      const { result, written, items } = await run(
        firewall(['1.1.1.1']),
        cf,
        st,
        'down',
        { changedLocally: true }
      );
      assert.strictEqual(result.localWritten, false);
      assert.strictEqual(written, null);
      assert.match(items[0].skipped, /firewall.json changed/);
      assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
    });

    it("up doesn't push lists that changed during the sync", async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const st = state(['1.1.1.1']);
      const { items } = await run(
        firewall(['1.1.1.1', '2.2.2.2']),
        cf,
        st,
        'up',
        { changedLocally: true }
      );
      assert.strictEqual(cf.calls.length, 0);
      assert.match(items[0].skipped, /lists changed during the sync/);
      assert.deepStrictEqual(st.lists['block-ips'].values, ['1.1.1.1']);
    });

    it('keeps the state of a list named __proto__', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const data = firewall(['1.1.1.1', '2.2.2.2'], { id: '__proto__' });
      const st = { lists: {} };
      await run(data, cf, st, 'up');

      // Saved as an own property, so it survives JSON
      const saved = JSON.parse(JSON.stringify(st));
      assert.ok(Object.prototype.hasOwnProperty.call(saved.lists, '__proto__'));
      assert.deepStrictEqual(
        sync.savedState(saved, '__proto__').values.sort(),
        ['1.1.1.1', '2.2.2.2']
      );
      assert.strictEqual(Object.getPrototypeOf(st.lists), Object.prototype);
    });

    it('leaves a rule changed during an earlier update of the same sync', async () => {
      const data = validate({
        lists: ['rule-a', 'rule-b'].map((ruleId) => ({
          id: ruleId,
          type: 'ip',
          action: 'block',
          cloudflare: { rule_id: ruleId },
          entries: [{ value: '1.1.1.1' }, { value: '2.2.2.2' }],
        })),
      });
      const st = {
        lists: Object.fromEntries(
          ['rule-a', 'rule-b'].map((id) => [
            id,
            { rule_id: id, version: '3', values: ['1.1.1.1'] },
          ])
        ),
      };
      const cf = fakeCloudflare([
        ipRule(['1.1.1.1'], { id: 'rule-a' }),
        ipRule(['1.1.1.1'], { id: 'rule-b' }),
      ]);
      const patch = cf.client.patchRule;
      cf.client.patchRule = async (...args) => {
        // Someone edits rule-b while rule-a is being updated
        const other = cf.zone.rules.find((r) => r.id === 'rule-b');
        other.expression = '(ip.src in {1.1.1.1 9.9.9.9})';
        other.version = '4';
        return patch(...args);
      };
      const items = sync.plan({
        data,
        state: st,
        ruleset: await cf.client.getEntrypoint(),
        direction: 'up',
      });
      const result = await sync.apply(items, {
        client: cf.client,
        originalData: data,
        readData: () => data,
        writeData: () => assert.fail('up never writes the lists'),
        state: st,
      });

      assert.strictEqual(cf.calls.length, 1);
      assert.strictEqual(result.items[0].applied, true);
      assert.match(result.items[1].skipped, /rule changed since the plan/);
      assert.match(
        cf.zone.rules.find((r) => r.id === 'rule-b').expression,
        /9\.9\.9\.9/
      );
    });

    it('keeps syncing a description cleared in Cloudflare', () => {
      const values = ['1.1.1.1'];
      // Cleared in Cloudflare: the list stores ""
      const cleared = planOne(
        firewall(values, { description: 'Old' }),
        [ipRule(values, { description: undefined })],
        state(values)
      );
      assert.strictEqual(cleared.list.description, '');

      // Set again in Cloudflare: imported, not ignored
      const again = planOne(
        firewall(values, { description: '' }),
        [ipRule(values, { description: 'Back again' })],
        state(values)
      );
      assert.strictEqual(again.list.description, 'Back again');
      assert.ok(again.localChanged);

      // "" and no description in Cloudflare agree
      const same = planOne(
        firewall(values, { description: '' }),
        [ipRule(values, { description: undefined })],
        state(values)
      );
      assert.deepStrictEqual(same.conflicts, []);
    });

    it("keeps the rule's other settings, a custom response only for the same action", () => {
      const settings = {
        action_parameters: { response: { status_code: 403, content: 'No' } },
        logging: { enabled: true },
      };
      const same = planOne(
        firewall(['1.1.1.1', '2.2.2.2']),
        [ipRule(['1.1.1.1'], settings)],
        state(['1.1.1.1']),
        'up'
      );
      assert.deepStrictEqual(
        same.patch.action_parameters,
        settings.action_parameters
      );
      assert.deepStrictEqual(same.patch.logging, settings.logging);

      const challenged = planOne(
        firewall(['1.1.1.1', '2.2.2.2'], { action: 'challenge' }),
        [ipRule(['1.1.1.1'], settings)],
        state(['1.1.1.1']),
        'up'
      );
      assert.strictEqual(challenged.patch.action_parameters, undefined);
      assert.deepStrictEqual(challenged.patch.logging, settings.logging);
    });

    it('makes no update once its signal is aborted', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      const data = firewall(['1.1.1.1', '2.2.2.2']);
      const st = state(['1.1.1.1']);
      const items = sync.plan({
        data,
        state: st,
        ruleset: await cf.client.getEntrypoint(),
        direction: 'up',
      });
      const controller = new AbortController();
      controller.abort(new Error('stopping'));
      await assert.rejects(
        sync.apply(items, {
          client: cf.client,
          originalData: data,
          readData: () => data,
          writeData: () => assert.fail('no write'),
          state: st,
          signal: controller.signal,
        }),
        /stopping/
      );
      assert.strictEqual(cf.calls.length, 0);
    });

    it('does nothing for lists with errors', async () => {
      const cf = fakeCloudflare([
        ipRule([], { expression: '(ip.src in $list)' }),
      ]);
      const st = { lists: {} };
      const { result, items } = await run(firewall(['1.1.1.1']), cf, st, 'up');
      assert.strictEqual(cf.calls.length, 0);
      assert.strictEqual(items[0].skipped, 'errors');
      assert.strictEqual(result.localWritten, false);
      assert.deepStrictEqual(st.lists, {});
    });

    it('fails loudly if Cloudflare does not reflect the update', async () => {
      const cf = fakeCloudflare([ipRule(['1.1.1.1'])]);
      cf.client.patchRule = async () => JSON.parse(JSON.stringify(cf.zone));
      await assert.rejects(
        run(firewall(['1.1.1.1', '2.2.2.2']), cf, state(['1.1.1.1']), 'up'),
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
