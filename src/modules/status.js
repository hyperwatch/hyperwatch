const { api } = require('../app');
const html = require('../app/html');
const monitoring = require('../lib/monitoring');
const { escapeHtml, fillHost, formatTable } = require('../lib/util');

/**
 * The sum of the counts of a speed, null without it
 * @param {Entry} entry
 * @param {string[]} path
 * @returns {number | null}
 */
const aggregateCount = (entry, path) =>
  entry.hasIn(path)
    ? /** @type {IndexedNumbers} */ (entry.getIn(path)).reduce(
        (p, c) => p + c,
        0
      )
    : null;

/**
 * A row of the status table
 * @param {Entry} entry
 * @param {string | null} format
 */
function mapper(entry, format) {
  return {
    name: entry.get('name'),
    type: entry.get('type'),
    count15m:
      aggregateCount(entry, ['speeds', 'processed', 'per_minute']) ||
      aggregateCount(entry, ['speeds', 'accepted', 'per_minute']) ||
      (format !== 'json' ? '' : null),
    count24h:
      aggregateCount(entry, ['speeds', 'processed', 'per_hour']) ||
      aggregateCount(entry, ['speeds', 'accepted', 'per_hour']) ||
      (format !== 'json' ? '' : null),
    status: entry.get('status'),
  };
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function handler(req, res) {
  const format =
    /** @type {string | undefined} */ (req.params.format) ||
    (req.query.raw ? 'json' : null);
  // The monitoring entries as they are, in JSON only: the HTML table can't
  // show Immutable Maps (?raw=1 alone defaults to JSON)
  const raw = req.query.raw && format === 'json' ? true : false;

  if (format && !['json', 'txt'].includes(format)) {
    res.sendStatus(404);
    return;
  }

  let rawData = monitoring.getAllComputed();

  if (req.query.type) {
    rawData = rawData.filter((entry) => entry.get('type') === req.query.type);
  }

  const data = raw ? rawData : rawData.map((entry) => mapper(entry, format));

  if (format === 'json') {
    res.send(
      raw
        ? data
        : /** @type {Row[]} */ (data).map((row) => ({
            ...row,
            status: fillHost(row.status, (scheme) =>
              html.baseAddress(req, scheme)
            ),
          }))
    );
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Entries without traffic in the last 15 minutes are grey
    const rowClass = (/** @type {Record<string, any>} */ entry) =>
      entry.count15m ? null : 'grey';
    const rows = /** @type {Row[]} */ (data).map((row) => ({
      ...row,
      status: fillHost(row.status, (scheme) =>
        escapeHtml(html.baseAddress(req, scheme))
      ),
    }));
    res.send(
      html.page(req, { title: 'status' }, formatTable(rows, { rowClass }))
    );
  }
}

function start() {
  // The status page is also the home page
  html.registerSection('status');
  api.get('/', handler);
  api.get('/status{.:format}', handler);
}

/** @typedef {import('immutable').Map<string, any>} Entry */
/** @typedef {import('../lib/speed').IndexedNumbers} IndexedNumbers */
/** @typedef {ReturnType<typeof mapper>} Row */

module.exports = { start };
