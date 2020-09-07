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

exports.aggregateSpeed = (entry, key) =>
  entry
    .getIn(['speed', key])
    .compute()
    .reduce((p, c) => p + c, 0);

exports.formatTable = (data) => {
  if (!data || data.length === 0) {
    return '';
  }

  const headings = `<tr>${Object.keys(data[0])
    .map((key) => `<th>${key}</th>`)
    .join('')}</tr>`;

  const rows = data
    .map(
      (entry) =>
        `<tr>${Object.values(entry)
          .map((value) => `<td>${value || ''}</td>`)
          .join('')}</tr>`
    )
    .join('\n');

  return `<table>\n${headings}\n${rows}\n</table>`;
};

exports.md5 = (string) => crypto.createHash('md5').update(string).digest('hex');
