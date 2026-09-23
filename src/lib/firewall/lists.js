/**
 * Firewall lists: typed lists of IPs/CIDRs or user agents, each optionally
 * owning one Cloudflare custom rule. See docs/firewall.md.
 */
const fs = require('fs');

const IPCIDR = require('ip-cidr').default;

const TYPES = ['ip', 'user_agent'];
const ACTIONS = ['block', 'challenge', 'monitor'];
const UA_MATCHES = ['eq', 'contains'];

// Cloudflare action for each list action; monitor has no edge equivalent on
// the Pro plan (no `log` action), so monitor lists stay local-only.
const CLOUDFLARE_ACTIONS = { block: 'block', challenge: 'managed_challenge' };

// RFC 5952 form for IPv6 (lowercase, zeros compressed); IPv4 unchanged
function canonicalAddress(address) {
  if (!address.includes(':')) {
    return address;
  }
  return new URL(`http://[${address}]`).hostname.slice(1, -1);
}

// Canonical form of an IP or CIDR, so the same value written differently
// locally and in Cloudflare compares equal. Throws on invalid input.
function canonicalIp(value) {
  if (typeof value !== 'string' || value.trim() !== value || !value) {
    throw new Error(`invalid IP "${value}"`);
  }
  if (!value.includes('/')) {
    if (!IPCIDR.isValidAddress(value)) {
      throw new Error(`invalid IP "${value}"`);
    }
    return canonicalAddress(value);
  }
  if (!IPCIDR.isValidCIDR(value)) {
    throw new Error(`invalid CIDR "${value}"`);
  }
  const [address, prefix] = value.split('/');
  const network = canonicalAddress(new IPCIDR(value).start());
  if (canonicalAddress(address) !== network) {
    throw new Error(
      `CIDR "${value}" has host bits set, did you mean "${network}/${prefix}"?`
    );
  }
  return `${network}/${prefix}`;
}

function canonicalUserAgent(value) {
  // eslint-disable-next-line no-control-regex
  if (typeof value !== 'string' || !value || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`invalid user agent ${JSON.stringify(value)}`);
  }
  return value;
}

const canonicalValue = (type, value) =>
  type === 'ip' ? canonicalIp(value) : canonicalUserAgent(value);

/**
 * Validate a parsed firewall.json and return it with every entry value in
 * canonical form. Throws with a message naming the offending list/entry.
 */
function validate(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.lists)) {
    throw new Error('firewall: expected an object with a "lists" array');
  }
  const ids = new Set();
  const lists = data.lists.map((list, i) => {
    const where = `firewall: list ${list && list.id ? `"${list.id}"` : `#${i}`}`;
    if (!list || typeof list !== 'object') {
      throw new Error(`${where}: expected an object`);
    }
    if (typeof list.id !== 'string' || !list.id) {
      throw new Error(`${where}: missing "id"`);
    }
    if (ids.has(list.id)) {
      throw new Error(`${where}: duplicate id`);
    }
    ids.add(list.id);
    if (!TYPES.includes(list.type)) {
      throw new Error(`${where}: "type" must be one of ${TYPES.join(', ')}`);
    }
    if (!ACTIONS.includes(list.action)) {
      throw new Error(
        `${where}: "action" must be one of ${ACTIONS.join(', ')}`
      );
    }
    if (list.type === 'user_agent' && list.match !== undefined) {
      if (!UA_MATCHES.includes(list.match)) {
        throw new Error(
          `${where}: "match" must be one of ${UA_MATCHES.join(', ')}`
        );
      }
    }
    if (list.cloudflare !== undefined) {
      if (
        !list.cloudflare ||
        typeof list.cloudflare.rule_id !== 'string' ||
        !list.cloudflare.rule_id
      ) {
        throw new Error(`${where}: "cloudflare.rule_id" is required`);
      }
      if (!CLOUDFLARE_ACTIONS[list.action]) {
        throw new Error(
          `${where}: "${list.action}" lists can't be linked to Cloudflare`
        );
      }
    }
    if (!Array.isArray(list.entries)) {
      throw new Error(`${where}: "entries" must be an array`);
    }
    const seen = new Set();
    const entries = list.entries.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`${where}: entries must be objects with a "value"`);
      }
      let value;
      try {
        value = canonicalValue(list.type, entry.value);
      } catch (err) {
        throw new Error(`${where}: ${err.message}`, { cause: err });
      }
      if (seen.has(value)) {
        throw new Error(`${where}: duplicate entry "${value}"`);
      }
      seen.add(value);
      return { ...entry, value };
    });
    return { ...list, entries };
  });
  return { ...data, lists };
}

function load(path) {
  return validate(JSON.parse(fs.readFileSync(path, 'utf8')));
}

// Stable output: entries sorted by value so diffs stay readable
function serialize(data) {
  const lists = data.lists.map((list) => ({
    ...list,
    entries: [...list.entries].sort((a, b) =>
      a.value < b.value ? -1 : a.value > b.value ? 1 : 0
    ),
  }));
  return `${JSON.stringify({ ...data, lists }, null, 2)}\n`;
}

// Atomic write: a reader (or fs.watchFile) never sees a partial file
function save(path, data) {
  const tmp = `${path}.tmp`;
  fs.writeFileSync(tmp, serialize(validate(data)));
  fs.renameSync(tmp, path);
}

function compileList(list) {
  if (list.type === 'ip') {
    const addresses = new Set();
    const cidrs = [];
    for (const { value } of list.entries) {
      if (value.includes('/')) {
        cidrs.push(new IPCIDR(value));
      } else {
        addresses.add(value);
      }
    }
    return (log) => {
      const address =
        log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
      if (!address || !IPCIDR.isValidAddress(address)) {
        return null;
      }
      const canonical = canonicalAddress(address);
      if (addresses.has(canonical)) {
        return canonical;
      }
      const cidr = cidrs.find((c) => c.contains(canonical));
      return cidr ? cidr.toString() : null;
    };
  }

  const values = list.entries.map((entry) => entry.value);
  if (list.match === 'contains') {
    return (log) => {
      const ua = userAgent(log);
      return (ua && values.find((value) => ua.includes(value))) || null;
    };
  }
  const exact = new Set(values);
  return (log) => {
    const ua = userAgent(log);
    return ua && exact.has(ua) ? ua : null;
  };
}

function userAgent(log) {
  const headers = log.getIn(['request', 'headers']);
  if (!headers) {
    return null;
  }
  const ua = headers.get('user-agent');
  if (ua !== undefined) {
    return ua;
  }
  const key = headers.keySeq().find((k) => k.toLowerCase() === 'user-agent');
  return key ? headers.get(key) : null;
}

/**
 * Compile validated lists into a single matcher. Returns
 * `(log) => { list, action, value } | null`, first matching list wins.
 */
function compile(data) {
  const matchers = data.lists.map((list) => ({
    list,
    match: compileList(list),
  }));
  return (log) => {
    for (const { list, match } of matchers) {
      const value = match(log);
      if (value !== null) {
        return { list: list.id, action: list.action, value };
      }
    }
    return null;
  };
}

function findList(data, listId) {
  const list = data.lists.find((l) => l.id === listId);
  if (!list) {
    throw new Error(`firewall: unknown list "${listId}"`);
  }
  return list;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Return a copy of `data` with `value` added to `listId`. Adding a value
 * that is already present is a no-op.
 */
function addEntry(data, listId, { value, reason, source }) {
  const list = findList(data, listId);
  const canonical = canonicalValue(list.type, value);
  if (list.entries.some((entry) => entry.value === canonical)) {
    return data;
  }
  const entry = { value: canonical, added: today() };
  if (reason) {
    entry.reason = reason;
  }
  if (source) {
    entry.source = source;
  }
  return replaceList(data, { ...list, entries: [...list.entries, entry] });
}

// Return a copy of `data` without `value` in `listId`
function removeEntry(data, listId, value) {
  const list = findList(data, listId);
  const canonical = canonicalValue(list.type, value);
  return replaceList(data, {
    ...list,
    entries: list.entries.filter((entry) => entry.value !== canonical),
  });
}

function replaceList(data, list) {
  return {
    ...data,
    lists: data.lists.map((l) => (l.id === list.id ? list : l)),
  };
}

module.exports = {
  CLOUDFLARE_ACTIONS,
  canonicalIp,
  canonicalValue,
  validate,
  load,
  save,
  serialize,
  compile,
  addEntry,
  removeEntry,
  today,
};
