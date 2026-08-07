const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { stringify } = require('csv-stringify/sync');
const express = require('express');

const monitoring = require('../lib/monitoring');
const persistence = require('../lib/persistence');
const { formatTable } = require('../lib/util');
const stylesheet = require('../stylesheet');

const script = fs.readFileSync(path.join(__dirname, '..', 'script.js'));

const app = express();

app.use(express.json());

app.streamToHttp = (
  endpoint,
  stream,
  formatter,
  { name = `HTTP: ${endpoint}`, monitoringEnabled = false } = {}
) => {
  const requests = {};

  let monitor;
  if (monitoringEnabled) {
    monitor = monitoring.register({
      name,
      speeds: ['processed'],
      type: 'output',
    });
  }

  const updateMonitoringStatus = () => {
    if (monitor) {
      const clientsSize = Object.keys(requests).length;
      if (clientsSize) {
        monitor.status = `${clientsSize} client${
          clientsSize > 1 ? 's' : ''
        } listening on ${endpoint}`;
      } else {
        monitor.status = `Waiting for clients on ${endpoint}`;
      }
    }
  };

  updateMonitoringStatus();

  app.get(endpoint, (req, res) => {
    const requestId = crypto.randomUUID();
    requests[requestId] = [req, res];
    updateMonitoringStatus();

    const close = () => {
      delete requests[requestId];
      updateMonitoringStatus();
    };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');

    res.write(
      `<!DOCTYPE html>
<html>
<head>
<style>
${stylesheet}
body { display: flex; flex-direction: column-reverse; }
</style>
</head>
<body>`
    );

    req.on('close', close);
    res.on('close', close);
  });

  stream.map((log) => {
    Object.values(requests).forEach(([req, res]) => {
      const grep = req.query.grep;
      const line = formatter.format(log, 'html');
      if (!grep || line.includes(grep)) {
        res.write(`<div>${line}</div>\n`);
      }
    });
  });
};

app.registerAggregator = (name, aggregator) => {
  persistence.register(name, aggregator);
  app.get(`/${name}.:format(json|csv)?`, (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : null);
    const limit = req.query.limit || 100;
    const sort = req.query.sort || 'count15m';

    const data = aggregator.getData({
      sort,
      limit,
      format: format === 'csv' ? 'json' : format,
      raw,
    });

    if (format === 'csv') {
      const rows = data.toJS();
      const columns = Object.keys(rows[0] || {}).filter(
        (k) => k !== 'activity'
      );
      const csv = stringify(rows, { header: true, columns });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name}.csv"`
      );
      res.send(csv);
    } else if (format === 'json') {
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        `<!DOCTYPE html>
<html>
<head>
<style>${stylesheet}</style>
<script>${script}</script>
</head>
<body>${formatTable(data.toJS())}</body>
</html>`
      );
    }
  });

  app.get(`/${name}/:identifier.:format(json)?`, (req, res) => {
    const entry = aggregator.get(req.params.identifier);
    if (!entry) {
      res.status(404).send('Not Found');
    } else {
      res.send(entry.toJSON());
    }
  });
};

module.exports = app;
