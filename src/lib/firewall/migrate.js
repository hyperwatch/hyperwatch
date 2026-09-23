/**
 * Convert a legacy rule-based firewall.json ({ rules: [{ id, action, match,
 * cloudflare? }] }) into firewall lists. Rules that only match IPs or exact
 * user agents become lists; everything else is returned untouched as the
 * legacy backup.
 */
const { canonicalValue, validate } = require('./lists');

const IP_KEYS = new Set(['address', 'addresses', 'cidrs', 'address_dates']);
const UA_KEYS = new Set(['user_agents']);

const LOCAL_ACTIONS = { block: 'block', managed_challenge: 'challenge' };

function kind(rule) {
  const keys = Object.keys(rule.match || {});
  if (keys.length === 0) {
    return null;
  }
  if (
    keys.every((key) => IP_KEYS.has(key)) &&
    keys.some((k) => k !== 'address_dates')
  ) {
    return 'ip';
  }
  if (keys.every((key) => UA_KEYS.has(key))) {
    return 'user_agent';
  }
  return null;
}

function ruleValues(rule, type) {
  const match = rule.match;
  if (type === 'user_agent') {
    return match.user_agents || [];
  }
  return [
    ...(match.address ? [match.address] : []),
    ...(match.addresses || []),
    ...(match.cidrs || []),
  ];
}

function migrate(old) {
  if (!old || !Array.isArray(old.rules)) {
    throw new Error('migrate: expected an object with a "rules" array');
  }
  const lists = new Map();
  const legacy = [];
  const invalid = [];
  const report = { lists: {}, legacy: {} };

  const backup = (rule, reason) => {
    legacy.push(rule);
    report.legacy[reason] = (report.legacy[reason] || 0) + 1;
  };

  for (const rule of old.rules) {
    const type = kind(rule);
    if (!type) {
      const keys =
        Object.keys(rule.match || {})
          .sort()
          .join('+') || 'no match';
      backup(rule, keys);
      continue;
    }

    // Linked rules take the action Cloudflare enforces
    let action = rule.action;
    if (rule.cloudflare) {
      action = LOCAL_ACTIONS[rule.cloudflare.action] || rule.action;
    }
    if (!['block', 'challenge', 'monitor'].includes(action)) {
      backup(rule, `action ${action}`);
      continue;
    }
    if (rule.cloudflare && (!rule.cloudflare.id || action === 'monitor')) {
      backup(rule, 'unsupported Cloudflare link');
      continue;
    }

    const noun = type === 'ip' ? 'ips' : 'user-agents';
    let id = rule.cloudflare ? `${action}-${noun}` : `${action}-${noun}-local`;
    if (rule.cloudflare && lists.has(id)) {
      id = `${id}-${rule.cloudflare.id.slice(0, 8)}`;
    }
    if (!lists.has(id)) {
      const list = { id, type, action, entries: [] };
      if (type === 'user_agent') {
        list.match = 'eq';
      }
      if (rule.cloudflare) {
        list.cloudflare = { rule_id: rule.cloudflare.id };
        if (rule.reason) {
          list.note = rule.reason;
        }
      }
      lists.set(id, list);
    }
    const list = lists.get(id);
    const dates = rule.match.address_dates || {};

    for (const value of ruleValues(rule, type)) {
      let canonical;
      try {
        canonical = canonicalValue(type, value);
      } catch (err) {
        invalid.push({ rule: rule.id, value, error: err.message });
        continue;
      }
      if (list.entries.some((entry) => entry.value === canonical)) {
        continue;
      }
      const entry = { value: canonical };
      // Per-rule reasons describe the value for single-value dashboard rules
      if (!rule.cloudflare && rule.reason) {
        entry.reason = rule.reason;
      }
      const added = dates[value] || (!rule.cloudflare && rule.created);
      if (added) {
        entry.added = added;
      }
      const source = rule.createdBy || rule.source;
      if (source) {
        entry.source = source;
      }
      list.entries.push(entry);
    }
  }

  const firewall = validate({ lists: [...lists.values()] });
  for (const list of firewall.lists) {
    report.lists[list.id] = list.entries.length;
  }
  if (invalid.length) {
    report.legacy['invalid values'] = invalid.length;
  }
  return {
    firewall,
    legacy: { rules: legacy, invalid_values: invalid },
    report,
  };
}

module.exports = { migrate };
