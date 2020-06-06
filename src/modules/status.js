const Table = require('easy-table');

const { api } = require('../app');
const monitoring = require('../lib/monitoring');

const aggregateSpeed = (entry, path) =>
  entry.hasIn(path) ? entry.getIn(path).reduce((p, c) => p + c, 0) : null;

function mapper(entry, format) {
  return {
    name: entry.get('name'),
    type: entry.get('type'),
    '15m':
      aggregateSpeed(entry, ['speeds', 'processed', 'per_minute']) ||
      aggregateSpeed(entry, ['speeds', 'accepted', 'per_minute']) ||
      (format === 'txt' ? '' : null),
    '24h':
      aggregateSpeed(entry, ['speeds', 'processed', 'per_hour']) ||
      aggregateSpeed(entry, ['speeds', 'accepted', 'per_hour']) ||
      (format === 'txt' ? '' : null),
    status: entry.get('status'),
  };
}

function load() {
  api.get('/status(.:format(txt|json))?', (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : 'txt');

    let rawData = monitoring.getAllComputed();

    if (req.query.type) {
      rawData = rawData.filter((entry) => entry.get('type') === req.query.type);
    }

    const data = raw ? rawData : rawData.map((entry) => mapper(entry, format));

    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(Table.print(data));
    } else {
      res.send(data);
    }
  });
}

module.exports = { load };