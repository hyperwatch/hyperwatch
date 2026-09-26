const crypto = require('crypto');

const { stringify } = require('csv-stringify/sync');
const express = require('express');

const monitoring = require('../lib/monitoring');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { logMatches } = require('../lib/util');

const html = require('./html');
const wsServer = require('./ws-server');

const app = express();

// WebSocket upgrades dispatched by mount() when Hyperwatch is embedded
app.use(wsServer.middleware);

app.use(express.json());

app.get('/nodes{.:format}', (req, res) => {
  const nodes = Object.keys(pipeline.nodes);
  const format = req.params.format;
  const view = req.query.view;

  if (format && !['csv', 'json'].includes(format)) {
    res.sendStatus(404);
    return;
  }

  if (format === 'csv') {
    const csv = stringify(
      nodes.map((name) => ({ name })),
      {
        header: true,
        columns: ['name'],
      }
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="nodes.csv"');
    res.send(csv);
  } else if (format === 'json') {
    if (view === 'tree') {
      res.json(pipeline.getTree());
    } else {
      res.json(nodes);
    }
  } else {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(
      view === 'tree'
        ? html.pipelinePage(req, pipeline.getTree())
        : html.nodesPage(req, nodes)
    );
  }
});

// The pipeline tree: inputs, nodes and what runs on them
html.registerSection('pipeline');
app.get('/pipeline', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html.pipelinePage(req, pipeline.getTree()));
});

app.streamToHttp = (
  endpoint,
  stream,
  formatter,
  {
    name = `HTTP: ${endpoint}`,
    monitoringEnabled = false,
    // history(limit, filters): the latest logs matching the filters, newest
    // first, shown before live ones
    history,
    // header(req): more HTML under the navigation of the stream page
    header,
  } = {}
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

  // ?identity=, ?signature=, ?address= keep matching logs, ?grep= lines
  // including the given text
  const writeLog = (req, res, log) => {
    if (!logMatches(log, req.query)) {
      return;
    }
    const grep = req.query.grep;
    const line = formatter.format(log, 'html');
    if (!grep || line.includes(grep)) {
      res.write(html.streamLine(line));
    }
  };

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
      html.streamHead(req, {
        title: endpoint.slice(1),
        header: header ? header(req) : '',
      })
    );

    // The latest logs first, oldest first like live ones: ?history=<n>
    // (default 100), ?history=0 to only show live logs
    if (history) {
      const limit = parseInt(req.query.history, 10);
      const logs = history(limit >= 0 ? limit : 100, req.query);
      for (const log of logs.reverse()) {
        writeLog(req, res, log);
      }
    }

    req.on('close', close);
    res.on('close', close);
  });

  stream.map((log) => {
    Object.values(requests).forEach(([req, res]) => writeLog(req, res, log));
  }, `http:${endpoint}`);
};

// htmlOptions: see html.aggregatorView()
app.registerAggregator = (name, aggregator, htmlOptions) => {
  const htmlView = html.aggregatorView(name, htmlOptions);
  persistence.register(name, aggregator);
  app.get(`/${name}{.:format}`, (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : null);
    const limit = req.query.limit || 100;
    // Unknown sorts fall back to count15m, like in aggregator.getData()
    const sort =
      aggregator.sorters && aggregator.sorters[req.query.sort]
        ? req.query.sort
        : 'count15m';

    if (format && !['csv', 'json'].includes(format)) {
      res.sendStatus(404);
      return;
    }

    const data = aggregator.getData({
      sort,
      limit,
      format: format === 'csv' ? 'json' : format,
      raw,
    });

    if (format === 'csv') {
      const rows = data.toJS();
      const csv = stringify(rows, {
        header: true,
        columns: Object.keys(rows[0] || {}),
      });
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
        htmlView(req, { rows: data.toJS(), sorters: aggregator.sorters, sort })
      );
    }
  });

  app.delete(`/${name}`, (req, res) => {
    aggregator.reset();
    res.send({ success: true });
  });

  app.get(`/${name}/:identifier{.json}`, (req, res) => {
    const entry = aggregator.get(req.params.identifier);
    if (!entry) {
      res.status(404).send('Not Found');
    } else {
      res.send(entry.toJSON());
    }
  });
};

module.exports = app;
