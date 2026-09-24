/**
 * One-way syncs between firewall lists and the Cloudflare custom rules they
 * own: `up` (firewall.json to Cloudflare) and `down` (Cloudflare to
 * firewall.json). Changes are measured against the base, the values both
 * sides agreed on after the last sync, kept in the sync state file.
 */
const fs = require('fs');

const expression = require('../cloudflare/expression');

const { CLOUDFLARE_ACTIONS, canonicalValue, today } = require('./lists');

const LOCAL_ACTIONS = Object.fromEntries(
  Object.entries(CLOUDFLARE_ACTIONS).map(([local, remote]) => [remote, local])
);

// Default sync state file: firewall.json -> firewall.sync.json
const defaultStatePath = (file) => `${file.replace(/\.json$/, '')}.sync.json`;

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

const DIRECTIONS = ['up', 'down'];

/**
 * Work out what a sync would do, without side effects.
 *
 * A sync goes one way. Each side's changes are measured against the base (the
 * values both sides agreed on at the last sync, kept in the sync state file),
 * so a sync never undoes changes still pending on the side it writes to:
 *
 * - down: apply Cloudflare's changes to firewall.json. Cloudflare's action
 *   and description win. The base becomes Cloudflare's values.
 * - up: apply firewall.json's changes to Cloudflare. The list's action and
 *   description win. The base becomes the local values.
 *
 * `down` then `up` is a full two-way sync.
 *
 * - data: validated firewall.json
 * - state: sync state ({ lists: { [listId]: { rule_id, values } } })
 * - ruleset: Cloudflare custom rules entrypoint ({ id, rules })
 * - direction: 'up' | 'down'
 * - only: optional list id to restrict the sync to
 */
function plan({ data, state, ruleset, direction, only }) {
  if (!DIRECTIONS.includes(direction)) {
    throw new Error('firewall: sync direction must be "up" or "down"');
  }
  const rules = new Map((ruleset.rules || []).map((rule) => [rule.id, rule]));
  const lists = data.lists.filter(
    (list) => list.cloudflare && (!only || list.id === only)
  );
  if (only && lists.length === 0) {
    throw new Error(`firewall: no Cloudflare-linked list "${only}"`);
  }
  return lists.map((list) =>
    planList(list, rules.get(list.cloudflare.rule_id), state, direction)
  );
}

function planList(list, rule, state, direction) {
  const item = {
    listId: list.id,
    ruleId: list.cloudflare.rule_id,
    direction,
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

  // Metadata: the list owns action and description, Cloudflare owns enabled
  if (rule.action !== CLOUDFLARE_ACTIONS[list.action]) {
    item.conflicts.push({
      field: 'action',
      local: list.action,
      remote: rule.action,
    });
  }
  if (list.description && list.description !== rule.description) {
    item.conflicts.push({
      field: 'description',
      local: list.description,
      remote: rule.description,
    });
  }
  if (rule.enabled === false) {
    item.warnings.push('Cloudflare rule is disabled; sync leaves it disabled');
  }

  return direction === 'down'
    ? planDown(item, list, rule, { local, remote, base })
    : planUp(item, list, rule, { local, remote, base });
}

function planDown(item, list, rule, { local, remote, base }) {
  item.toLocal = {
    add: [...remote].filter((v) => !base.has(v) && !local.has(v)).sort(),
    remove: [...local].filter((v) => base.has(v) && !remote.has(v)).sort(),
  };

  const action = LOCAL_ACTIONS[rule.action];
  if (!action) {
    item.errors.push(
      `Cloudflare action "${rule.action}" has no firewall list equivalent`
    );
    return item;
  }

  const removed = new Set(item.toLocal.remove);
  const entries = list.entries
    .filter((entry) => !removed.has(entry.value))
    .concat(
      item.toLocal.add.map((value) => ({
        value,
        reason: 'added in Cloudflare',
        added: today(),
        source: 'cloudflare',
      }))
    );
  item.list = { ...list, action, entries };
  if (list.description) {
    item.list.description = rule.description;
  }
  item.localChanged =
    item.toLocal.add.length > 0 ||
    item.toLocal.remove.length > 0 ||
    item.conflicts.length > 0;
  item.values = [...remote].sort();
  return item;
}

function planUp(item, list, rule, { local, remote, base }) {
  item.toRemote = {
    add: [...local].filter((v) => !base.has(v) && !remote.has(v)).sort(),
    remove: [...remote].filter((v) => base.has(v) && !local.has(v)).sort(),
  };

  const next = new Set(remote);
  item.toRemote.add.forEach((value) => next.add(value));
  item.toRemote.remove.forEach((value) => next.delete(value));
  if (next.size === 0) {
    item.errors.push(
      'sync would leave the Cloudflare rule empty; delete or disable the rule in Cloudflare instead, and unlink the list'
    );
    return item;
  }

  const remoteChanged =
    item.toRemote.add.length > 0 ||
    item.toRemote.remove.length > 0 ||
    item.conflicts.length > 0;
  if (remoteChanged) {
    try {
      item.patch = {
        expression: expression.build({
          ...list,
          entries: [...next].map((value) => ({ value })),
        }),
        action: CLOUDFLARE_ACTIONS[list.action],
        description: list.description || rule.description,
        enabled: rule.enabled,
      };
    } catch (err) {
      item.errors.push(err.message);
      return item;
    }
  }
  item.values = [...local].sort();
  return item;
}

const hasChanges = (item) => !!(item.patch || item.localChanged);

/**
 * Apply a plan. `up` patches Cloudflare, `down` writes firewall.json. Lists
 * with errors are skipped, as is a rule whose version moved since the plan
 * was made, and firewall.json when it changed on disk meanwhile; running the
 * sync again finishes the job.
 *
 * - originalData: the firewall.json the plan was made from
 * - readData / writeData: read and write firewall.json
 * - state: sync state, updated in place with the new base of each list synced
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
    done.push(item);
  }

  // Local writes (down): only when firewall.json is unchanged since the plan
  let localWritten = false;
  const toWrite = done.filter((item) => item.localChanged);
  if (toWrite.length) {
    const latest = readData();
    if (JSON.stringify(latest) === JSON.stringify(originalData)) {
      const byId = new Map(toWrite.map((item) => [item.listId, item.list]));
      writeData({
        ...latest,
        lists: latest.lists.map((list) => byId.get(list.id) || list),
      });
      localWritten = true;
    } else {
      for (const item of toWrite) {
        item.skipped = 'firewall.json changed during the sync';
      }
    }
  }

  for (const item of done) {
    if (item.skipped) {
      continue;
    }
    item.applied = true;
    state.lists[item.listId] = {
      rule_id: item.ruleId,
      version: item.newVersion || item.ruleVersion,
      values: item.values,
      synced_at: new Date().toISOString(),
    };
  }
  return { items, localWritten, state };
}

module.exports = {
  DIRECTIONS,
  defaultStatePath,
  loadState,
  saveState,
  plan,
  apply,
  hasChanges,
};
