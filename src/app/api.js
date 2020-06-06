const Table = require('easy-table');
const express = require('express');
const uuid = require('uuid');

const monitoring = require('../lib/monitoring');

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
    const requestId = uuid.v4();
    requests[requestId] = [req, res];
    updateMonitoringStatus();

    const close = () => {
      delete requests[requestId];
      updateMonitoringStatus();
    };

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'no-cache');

    req.on('close', close);
    res.on('close', close);
  });

  stream.map((log) => {
    Object.values(requests).forEach(([, res]) => {
      res.write(`${formatter(log)}\n`);
    });
  });
};

app.registerAggregator = (name, aggregator) => {
  app.get(`/${name}(.:format(txt|json))?`, (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : 'txt');
    const limit = req.query.limit || 100;
    const sort = req.query.sort || '15m';

    const data = aggregator.getData({
      sort,
      limit,
      format,
      raw,
    });

    if (format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(Table.print(data.toJS()));
    } else {
      res.send(data);
    }
  });
};

module.exports = app;
