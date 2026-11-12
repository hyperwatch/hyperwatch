const crypto = require('crypto');

const { fromJS } = require('immutable');

// Number of seconds since Unix epoch
/** @returns {number} */
exports.now = () => Math.floor(new Date().getTime() / 1000);

// Pseudo-boolean, as set in an environment variable: true for true, 1, "true"
// and "1" (case and surrounding spaces ignored), false for anything else
/**
 * @param {unknown} value
 * @returns {boolean}
 */
exports.parseBoolean = (value) =>
  ['true', '1'].includes(String(value).trim().toLowerCase());

// A number, given as a number or as a decimal string (as set in an
// environment variable), within `min` and `max`, and whole with `integer`;
// null for anything else. Number() alone reads false, '', ' ' or [0] as 0,
// true as 1, and '0x10' as 16
/**
 * @param {unknown} value
 * @param {{ integer?: boolean, min?: number, max?: number }} [options]
 * @returns {number | null}
 */
exports.parseNumber = (
  value,
  { integer = false, min = -Infinity, max = Infinity } = {}
) => {
  const number =
    typeof value === 'number' ||
    (typeof value === 'string' && /^\s*-?(\d+(\.\d*)?|\.\d+)\s*$/.test(value))
      ? Number(value)
      : NaN;
  if (
    !Number.isFinite(number) ||
    (integer && !Number.isInteger(number)) ||
    number < min ||
    number > max
  ) {
    return null;
  }
  return number;
};

/**
 * Return the complement of the predicate `pred`.
 *
 * If pred(x) returns trues, complement(pred)(x) return false.
 * @template {any[]} A
 * @param {(...args: A) => unknown} f
 * @returns {(...args: A) => boolean}
 */
exports.complement = (f) => {
  return function () {
    return !f.apply(
      null,
      /** @type {A} */ (Array.prototype.slice.call(arguments))
    );
  };
};

/**
 * Create a log from Express req/res
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {Log}
 */
exports.createLog = (req, res) => {
  return fromJS({
    request: {
      time: new Date().toISOString(),
      address: req.ip,
      method: req.method,
      url: req.originalUrl || req.url,
      headers: req.headers,
    },
    response: {
      status: res.statusCode,
    },
  });
};

// The hits, and the sum of the values, of the speed `key` of an aggregator
// entry (`per_minute`, `per_hour`…) over its window
/**
 * @param {import('immutable').Map<string, any>} entry
 * @param {string} key
 * @returns {number}
 */
exports.aggregateCount = (entry, key) =>
  /** @type {Speed} */ (entry.getIn(['speed', key]))
    .compute()
    .reduce((p, c) => p + c, 0);

/**
 * @param {import('immutable').Map<string, any>} entry
 * @param {string} key
 * @returns {number}
 */
exports.aggregateSum = (entry, key) =>
  /** @type {Speed} */ (entry.getIn(['speed', key]))
    .computeSum()
    .reduce((p, c) => p + c, 0);

// 12.3s under a minute, then whole seconds with minutes and hours: 9m26s,
// 9h15m26s. Units at zero are left out (2h, 2h5s).
/**
 * @param {number} ms
 * @returns {string}
 */
exports.formatDuration = (ms) => {
  const totalSeconds = ms / 1000;
  // Tenths as long as they read under a minute (59.9s), not 60.0s
  if (totalSeconds < 59.95) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const rounded = Math.round(totalSeconds);
  /** @type {Array<[number, string]>} */
  const units = [
    [Math.floor(rounded / 3600), 'h'],
    [Math.floor((rounded % 3600) / 60), 'm'],
    [rounded % 60, 's'],
  ];
  return units
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value}${unit}`)
    .join('');
};

// A table cell: numbers with thousands separators (1,234), empty for 0
/** @param {unknown} value */
const formatCell = (value) =>
  typeof value === 'number'
    ? value
      ? value.toLocaleString('en-US')
      : ''
    : value || '';

// heading(key) renders the content of a column heading, the key by default.
// rowClass(entry) gives an optional class to a row.
/**
 * @param {Record<string, any>[]} data
 * @param {{ heading?: (key: string) => string, rowClass?: (entry: Record<string, any>) => string | null }} [options]
 */
exports.formatTable = (
  data,
  { heading = (key) => key, rowClass = () => null } = {}
) => {
  if (!data || data.length === 0) {
    return '';
  }

  const headings = `<tr>${Object.keys(data[0])
    .map((key) => `<th>${heading(key)}</th>`)
    .join('')}</tr>`;

  const rows = data
    .map((entry) => {
      const className = rowClass(entry);
      return `<tr${className ? ` class="${className}"` : ''}>${Object.values(
        entry
      )
        .map((value) => `<td>${formatCell(value)}</td>`)
        .join('')}</tr>`;
    })
    .join('\n');

  return `<table>\n${headings}\n${rows}\n</table>`;
};

/**
 * @param {string} string
 * @returns {string}
 */
exports.md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

// The key of a log in the identities: its identity, or its address when it
// has none
/**
 * @param {Log} log
 * @returns {any}
 */
const identityKey = (log) =>
  log.get('identity') ||
  log.getIn(['address', 'value']) ||
  log.getIn(['request', 'address']);
exports.identityKey = identityKey;

// Whether a log matches the given filters, e.g. from a query string. The
// identity filter takes an identity key, so it also finds unnamed ones.
/**
 * @param {Log} log
 * @param {{ identity?: any, signature?: any, address?: any }} [filters]
 */
exports.logMatches = (log, { identity, signature, address } = {}) =>
  (!identity || identityKey(log) === identity) &&
  (!signature || log.getIn(['signature', 'id']) === signature) &&
  (!address ||
    (log.getIn(['address', 'value']) || log.getIn(['request', 'address'])) ===
      address);

// Inputs report where they listen as "http://__HOST__/input/log", as only
// requests know the host (and mount path) they are reached on.
// addressFor(scheme) gives it, e.g. "https://example.org/_hyperwatch".
/**
 * @template T
 * @param {T} text
 * @param {(scheme: string) => string} addressFor
 * @returns {T | string}
 */
exports.fillHost = (text, addressFor) =>
  typeof text === 'string'
    ? text.replace(/\b(http|ws):\/\/__HOST__/g, (match, scheme) =>
        addressFor(scheme)
      )
    : text;

/**
 * @param {unknown} string
 * @returns {string}
 */
exports.escapeHtml = (string) =>
  String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// HTML a format returns on purpose (links, marks, colors). Formatters escape
// every other value for HTML: logs are full of text chosen by the clients
// (URLs, user agents).
class SafeHtml {
  /** @param {unknown} html */
  constructor(html) {
    this.html = String(html);
  }

  toString() {
    return this.html;
  }
}

exports.SafeHtml = SafeHtml;

/**
 * @param {unknown} html
 * @returns {SafeHtml}
 */
exports.safeHtml = (html) => new SafeHtml(html);

// A value as HTML: kept when it's safeHtml(), escaped otherwise
/**
 * @param {unknown} value
 * @returns {string}
 */
exports.toHtml = (value) =>
  value instanceof SafeHtml ? value.html : exports.escapeHtml(value);

/** @typedef {import('../types').Log} Log */
/** @typedef {import('./speed').Speed} Speed */
