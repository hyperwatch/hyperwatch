const crypto = require('crypto');

const { fromJS } = require('immutable');

// Number of seconds since Unix epoch
exports.now = () => Math.floor(new Date().getTime() / 1000);

/**
 * Return the complement of the predicate `pred`.
 *
 * If pred(x) returns trues, complement(pred)(x) return false.
 */
exports.complement = (f) => {
  return function () {
    return !f.apply(null, Array.prototype.slice.call(arguments));
  };
};

/**
 * Create a log from Express req/res
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

exports.aggregateCount = (entry, key) =>
  entry
    .getIn(['speed', key])
    .compute()
    .reduce((p, c) => p + c, 0);

exports.aggregateSum = (entry, key) =>
  entry
    .getIn(['speed', key])
    .computeSum()
    .reduce((p, c) => p + c, 0);

// 12.3s under a minute, then whole seconds with minutes and hours: 9m26s,
// 9h15m26s. Units at zero are left out (2h, 2h5s).
exports.formatDuration = (ms) => {
  const totalSeconds = ms / 1000;
  // Tenths as long as they read under a minute (59.9s), not 60.0s
  if (totalSeconds < 59.95) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const rounded = Math.round(totalSeconds);
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
const formatCell = (value) =>
  typeof value === 'number'
    ? value
      ? value.toLocaleString('en-US')
      : ''
    : value || '';

// heading(key) renders the content of a column heading, the key by default.
// rowClass(entry) gives an optional class to a row.
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

exports.md5 = (string) => crypto.createHash('md5').update(string).digest('hex');

// The key of a log in the identities: its identity, or its address when it
// has none
const identityKey = (log) =>
  log.get('identity') ||
  log.getIn(['address', 'value']) ||
  log.getIn(['request', 'address']);
exports.identityKey = identityKey;

// Whether a log matches the given filters, e.g. from a query string. The
// identity filter takes an identity key, so it also finds unnamed ones.
exports.logMatches = (log, { identity, signature, address } = {}) =>
  (!identity || identityKey(log) === identity) &&
  (!signature || log.getIn(['signature', 'id']) === signature) &&
  (!address ||
    (log.getIn(['address', 'value']) || log.getIn(['request', 'address'])) ===
      address);

// Inputs report where they listen with a __HOST__ placeholder, as only
// requests know the host (and mount path) they are reached on
exports.fillHost = (text, { host, secure = false }) =>
  typeof text === 'string'
    ? text.replace(
        /\b(http|ws):\/\/__HOST__/g,
        (match, scheme) => `${scheme}${secure ? 's' : ''}://${host}`
      )
    : text;

exports.escapeHtml = (string) =>
  String(string)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
