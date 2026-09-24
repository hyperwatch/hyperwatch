/**
 * Build and parse the Cloudflare Rules language expressions for firewall
 * lists. Only the exact shapes `build` produces are parsed back, so a rule
 * someone edited by hand in Cloudflare is detected instead of rewritten.
 */

// Cloudflare's limit on a single rule expression
const MAX_LENGTH = 4096;

const quote = (value) =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function build(list) {
  const values = list.entries.map((entry) => entry.value).sort();
  if (values.length === 0) {
    throw new Error(
      `firewall: list "${list.id}" is empty; Cloudflare rules need at least one value`
    );
  }
  let expression;
  if (list.type === 'ip') {
    expression = `(ip.src in {${values.join(' ')}})`;
  } else {
    const operator = list.match === 'contains' ? 'contains' : 'eq';
    expression = values
      .map((value) => `(http.user_agent ${operator} ${quote(value)})`)
      .join(' or ');
  }
  if (expression.length > MAX_LENGTH) {
    throw new Error(
      `firewall: list "${list.id}" expression is ${expression.length} characters, over Cloudflare's ${MAX_LENGTH} limit; split the list`
    );
  }
  return expression;
}

// Read one double-quoted string starting at `i`; returns [value, nextIndex]
function readString(expression, i) {
  let value = '';
  for (let j = i + 1; j < expression.length; j++) {
    const char = expression[j];
    if (char === '\\') {
      const next = expression[j + 1];
      if (next !== '\\' && next !== '"') {
        return null;
      }
      value += next;
      j++;
    } else if (char === '"') {
      return [value, j + 1];
    } else {
      value += char;
    }
  }
  return null;
}

function parseIp(expression) {
  const match = expression.match(/^\(\s*ip\.src\s+in\s+\{([^{}]*)\}\s*\)$/);
  if (!match) {
    return { ok: false, reason: 'not a single "ip.src in {...}" clause' };
  }
  const values = match[1].split(/\s+/).filter(Boolean);
  if (values.length === 0) {
    return { ok: false, reason: 'empty IP set' };
  }
  return { ok: true, values };
}

function parseUserAgent(expression, operator) {
  const values = [];
  const clause = new RegExp(`^\\(\\s*http\\.user_agent\\s+${operator}\\s+`);
  let rest = expression.trim();
  for (;;) {
    const head = rest.match(clause);
    if (!head) {
      return {
        ok: false,
        reason: `expected "(http.user_agent ${operator} \\"...\\")" clauses joined by "or"`,
      };
    }
    const read = readString(rest, head[0].length);
    if (!read) {
      return { ok: false, reason: 'unterminated or invalid string' };
    }
    values.push(read[0]);
    rest = rest.slice(read[1]);
    const close = rest.match(/^\s*\)\s*/);
    if (!close) {
      return { ok: false, reason: 'expected ")" after user agent' };
    }
    rest = rest.slice(close[0].length);
    if (!rest) {
      return { ok: true, values };
    }
    const or = rest.match(/^or\s+/);
    if (!or) {
      return { ok: false, reason: `unexpected "${rest.slice(0, 20)}"` };
    }
    rest = rest.slice(or[0].length);
  }
}

/**
 * Parse an expression for a list of the given type/match.
 * Returns { ok: true, values } or { ok: false, reason }.
 */
function parse(expression, { type, match }) {
  if (typeof expression !== 'string') {
    return { ok: false, reason: 'missing expression' };
  }
  if (type === 'ip') {
    return parseIp(expression.trim());
  }
  return parseUserAgent(expression, match === 'contains' ? 'contains' : 'eq');
}

module.exports = { MAX_LENGTH, build, parse };
