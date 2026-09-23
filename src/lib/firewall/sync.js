/**
 * Two-way sync between firewall lists and the Cloudflare custom rules they
 * own. Each linked list is merged three ways: the local entries, the values
 * parsed from the rule's expression, and the base (the values both sides
 * agreed on after the last sync, kept in the sync state file).
 */
const fs = require('fs');

const expression = require('../cloudflare/expression');

const { CLOUDFLARE_ACTIONS, canonicalValue, today } = require('./lists');

const LOCAL_ACTIONS = Object.fromEntries(
  Object.entries(CLOUDFLARE_ACTIONS).map(([local, remote]) => [remote, local])
);

const difference = (a, b) => [...a].filter((value) => !b.has(value)).sort();

function loadState(path) {
  if (!fs.existsSync(path)) {
    return { lists: {} };
  }
  const state = JSON.parse(fs.readFileSync(path, 'utf8'));
  return state && state.lists ? state : { lists: {} };
}

function saveState(path, state) {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, path);
}

/**
 * Work out what a sync would do, without side effects.
 *
 * - data: validated firewall.json
 * - state: sync state ({ lists: { [listId]: { rule_id, values } } })
 * - ruleset: Cloudflare custom rules entrypoint ({ id, rules })
 * - prefer: 'local' | 'remote' to resolve action/description conflicts
 * - only: optional list id to restrict the sync to
 */
function plan({ data, state, ruleset, prefer, only }) {
  const rules = new Map((ruleset.rules || []).map((rule) => [rule.id, rule]));
  const lists = data.lists.filter(
    (list) => list.cloudflare && (!only || list.id === only)
  );
  if (only && lists.length === 0) {
    throw new Error(`firewall: no Cloudflare-linked list "${only}"`);
  }
  return lists.map((list) =>
    planList(list, rules.get(list.cloudflare.rule_id), state, prefer)
  );
}

function planList(list, rule, state, prefer) {
  const item = {
    listId: list.id,
    ruleId: list.cloudflare.rule_id,
    errors: [],
    warnings: [],
    conflicts: [],
    toRemote: { add: [], remove: [] },
    toLocal: { add: [], remove: [] },
  };
  if (!rule) {
    item.errors.push(
      `Cloudflare rule ${item.ruleId} not found in the zone's custom rules`
    );
    return item;
  }
  item.ruleVersion = rule.version;
  item.ruleDescription = rule.description;

  const parsed = expression.parse(rule.expression, list);
  if (!parsed.ok) {
    item.errors.push(
      `can't read the Cloudflare rule expression (${parsed.reason}); was it edited by hand?`
    );
    return item;
  }
  let remote;
  try {
    remote = new Set(parsed.values.map((v) => canonicalValue(list.type, v)));
  } catch (err) {
    item.errors.push(`Cloudflare rule has an ${err.message}`);
    return item;
  }

  const local = new Set(list.entries.map((entry) => entry.value));
  const saved = state.lists[list.id];
  const base = new Set(
    saved && saved.rule_id === item.ruleId ? saved.values : []
  );

  const merged = new Set(base);
  for (const value of [...local, ...remote]) {
    if (!base.has(value)) {
      merged.add(value);
    }
  }
  for (const value of base) {
    if (!local.has(value) || !remote.has(value)) {
      merged.delete(value);
    }
  }

  item.toRemote = {
    add: difference(merged, remote),
    remove: difference(remote, merged),
  };
  item.toLocal = {
    add: difference(merged, local),
    remove: difference(local, merged),
  };

  // Metadata: the list owns action and description, Cloudflare owns enabled
  let action = list.action;
  let description = list.description || rule.description;
  const remoteAction = LOCAL_ACTIONS[rule.action];
  if (rule.action !== CLOUDFLARE_ACTIONS[list.action]) {
    item.conflicts.push({
      field: 'action',
      local: list.action,
      remote: rule.action,
    });
    if (prefer === 'remote') {
      if (!remoteAction) {
        item.errors.push(
          `Cloudflare action "${rule.action}" has no firewall list equivalent`
        );
      }
      action = remoteAction;
    }
  }
  if (list.description && list.description !== rule.description) {
    item.conflicts.push({
      field: 'description',
      local: list.description,
      remote: rule.description,
    });
    if (prefer === 'remote') {
      description = rule.description;
    }
  }
  if (item.conflicts.length && !prefer) {
    item.errors.push(
      'Cloudflare rule metadata differs from the list; rerun with --prefer local or --prefer remote'
    );
  }
  if (rule.enabled === false) {
    item.warnings.push('Cloudflare rule is disabled; sync leaves it disabled');
  }
  if (merged.size === 0) {
    item.errors.push(
      'sync would leave the Cloudflare rule empty; delete or disable the rule in Cloudflare instead, and unlink the list'
    );
  }
  if (item.errors.length) {
    return item;
  }

  const entries = list.entries
    .filter((entry) => merged.has(entry.value))
    .concat(
      item.toLocal.add.map((value) => ({
        value,
        reason: 'added in Cloudflare',
        added: today(),
        source: 'cloudflare',
      }))
    );
  item.list = { ...list, action, entries };
  if (prefer === 'remote' && list.description) {
    item.list.description = description;
  }

  const remoteChanged =
    item.toRemote.add.length > 0 ||
    item.toRemote.remove.length > 0 ||
    (prefer === 'local' && item.conflicts.length > 0);
  if (remoteChanged) {
    try {
      item.patch = {
        expression: expression.build(item.list),
        action: CLOUDFLARE_ACTIONS[action],
        description,
        enabled: rule.enabled,
      };
    } catch (err) {
      item.errors.push(err.message);
      return item;
    }
  }
  item.localChanged =
    item.toLocal.add.length > 0 ||
    item.toLocal.remove.length > 0 ||
    (prefer === 'remote' && item.conflicts.length > 0);
  item.values = [...merged].sort();
  return item;
}

const hasChanges = (item) => !!(item.patch || item.localChanged);

/**
 * Apply a plan: Cloudflare first, then the local files (the documented order
 * for these rules). Lists with errors are skipped. A rule whose version moved
 * since the plan was made is left alone, as is firewall.json when it changed
 * on disk meanwhile; both converge on the next sync.
 *
 * - originalData: the firewall.json the plan was made from
 * - readData / writeData: read and write firewall.json
 * - state: sync state, updated in place for the lists written locally
 *
 * Returns the plan items annotated with `applied` / `skipped` reasons.
 */
async function apply(
  items,
  { client, originalData, readData, writeData, state }
) {
  const current = await client.getEntrypoint();
  const rules = new Map((current.rules || []).map((rule) => [rule.id, rule]));
  const done = [];
  let rulesetId = current.id;

  for (const item of items) {
    if (item.errors.length) {
      item.skipped = 'errors';
      continue;
    }
    const rule = rules.get(item.ruleId);
    if (!rule || rule.version !== item.ruleVersion) {
      item.skipped = 'the Cloudflare rule changed since the plan was made';
      continue;
    }
    if (item.patch) {
      const result = await client.patchRule(rulesetId, item.ruleId, item.patch);
      const updated = (result.rules || []).find((r) => r.id === item.ruleId);
      if (!updated || updated.expression !== item.patch.expression) {
        throw new Error(
          `firewall: Cloudflare rule ${item.ruleId} doesn't show the new expression after the update`
        );
      }
      if (updated.version === item.ruleVersion) {
        throw new Error(
          `firewall: Cloudflare rule ${item.ruleId} version didn't change after the update`
        );
      }
      item.newVersion = updated.version;
      rulesetId = result.id || rulesetId;
    }
    item.applied = true;
    done.push(item);
  }

  if (done.length === 0) {
    return { items, localWritten: false };
  }

  // Local mirror: only when firewall.json is unchanged since the plan
  const latest = readData();
  let localWritten = false;
  if (JSON.stringify(latest) === JSON.stringify(originalData)) {
    const byId = new Map(done.map((item) => [item.listId, item.list]));
    writeData({
      ...latest,
      lists: latest.lists.map((list) => byId.get(list.id) || list),
    });
    localWritten = true;
    for (const item of done) {
      state.lists[item.listId] = {
        rule_id: item.ruleId,
        version: item.newVersion || item.ruleVersion,
        values: item.values,
        synced_at: new Date().toISOString(),
      };
    }
  }
  return { items, localWritten, state };
}

module.exports = { loadState, saveState, plan, apply, hasChanges };
