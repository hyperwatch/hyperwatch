const { api } = require('../app');
const monitoring = require('../lib/monitoring');
const { formatTable } = require('../lib/util');
const stylesheet = require('../stylesheet');

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

function start() {
  api.get('/status(.:format(txt|json))?', (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : null);

    let rawData = monitoring.getAllComputed();

    if (req.query.type) {
      rawData = rawData.filter((entry) => entry.get('type') === req.query.type);
    }

    const data = raw ? rawData : rawData.map((entry) => mapper(entry, format));

    if (format === 'json') {
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.send(
        `<!DOCTYPE html><html><head><style>${stylesheet}</style></head><body>${formatTable(
          data
        )}</body></html>`
      );
    }
  });
}

module.exports = { start };
