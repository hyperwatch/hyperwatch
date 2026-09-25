const { api } = require('../app');
const html = require('../app/html');
const monitoring = require('../lib/monitoring');
const { formatTable } = require('../lib/util');

const aggregateCount = (entry, path) =>
  entry.hasIn(path) ? entry.getIn(path).reduce((p, c) => p + c, 0) : null;

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

function handler(req, res) {
  const raw = req.query.raw ? true : false;
  const format = req.params.format || (raw ? 'json' : null);

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
    res.send(data);
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Entries without traffic in the last 15 minutes are grey
    const rowClass = (entry) => (entry.count15m ? null : 'grey');
    res.send(
      html.page(req, { title: 'status' }, formatTable(data, { rowClass }))
    );
  }
}

function start() {
  // The status page is also the home page
  html.registerSection('status');
  api.get('/', handler);
  api.get('/status{.:format}', handler);
}

module.exports = { start };
