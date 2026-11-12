const crypto = require('crypto');

const { stringify } = require('csv-stringify/sync');
const express = require('express');

const monitoring = require('../lib/monitoring');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { escapeHtml, fillHost, logMatches } = require('../lib/util');
const version = require('../version');

const html = require('./html');
const wsServer = require('./ws-server');

/** @type {import('express').Express} */
const app = express();

// Live logs kept per HTTP stream while its history is read
const MAX_QUEUED_LOGS = 10000;

// Every response tells the client which Hyperwatch it talks to
app.use((req, res, next) => {
  res.setHeader('X-Hyperwatch-Version', version);
  next();
});

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
    // The HTML view of the nodes is the pipeline page
    res.redirect(`${req.baseUrl}/pipeline`);
  }
});

// The pipeline tree: inputs, nodes and what runs on them
html.registerSection('pipeline');
app.get('/pipeline', (req, res) => {
  const statusFor = (status) =>
    fillHost(status, (scheme) => escapeHtml(html.baseAddress(req, scheme)));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html.pipelinePage(req, pipeline.getTree(), statusFor));
});

/**
 * Options of streamToHttp()
 * @typedef {object} StreamOptions
 * @property {string} [name] Its name on the status page
 * @property {boolean} [monitoringEnabled] Show it on the status page
 * @property {(limit: number, filters: Record<string, any>) => Log[] | Promise<Log[]>} [history]
 *   The latest logs matching the filters, newest first, shown before live
 *   ones
 * @property {(req: import('express').Request) => string} [header] More HTML
 *   under the navigation of the stream page
 */

/**
 * Serves a stream of logs as an HTML page at `endpoint`, live.
 * @param {string} endpoint
 * @param {import('../lib/pipeline').Node} stream
 * @param {import('../lib/formatter').Formatter} formatter
 * @param {StreamOptions} [options]
 */
function streamToHttp(
  endpoint,
  stream,
  formatter,
  {
    name = `HTTP: ${endpoint}`,
    monitoringEnabled = false,
    history,
    header,
  } = {}
) {
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
    // [req, res, queue]: while the history is read (a promise), live logs
    // wait in the queue, so they follow it
    requests[requestId] = [req, res, null];
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
      const limit = parseInt(String(req.query.history), 10);
      const logs = history(limit >= 0 ? limit : 100, req.query);
      if (isPromise(logs)) {
        const queue = [];
        requests[requestId][2] = queue;
        logs
          .catch((err) => {
            console.error(`Error reading the history of ${endpoint}:`, err);
            return [];
          })
          .then((read) => {
            if (res.writableEnded || res.destroyed) {
              return;
            }
            for (const log of [...read].reverse()) {
              writeLog(req, res, log);
            }
            for (const log of queue) {
              writeLog(req, res, log);
            }
            if (requests[requestId]) {
              requests[requestId][2] = null;
            }
          });
      } else {
        for (const log of logs.reverse()) {
          writeLog(req, res, log);
        }
      }
    }

    req.on('close', close);
    res.on('close', close);
  });

  stream.map((log) => {
    Object.values(requests).forEach(([req, res, queue]) => {
      if (!queue) {
        writeLog(req, res, log);
      } else if (queue.length < MAX_QUEUED_LOGS && logMatches(log, req.query)) {
        queue.push(log);
      }
    });
  }, `http:${endpoint}`);
}

// ?filter=identified or ?filter=unidentified, on aggregators registered with
// identityFilter (their entries have an identity)
const identityFilters = new Map([
  ['identified', (entry) => !!entry.get('identity')],
  ['unidentified', (entry) => !entry.get('identity')],
]);

/**
 * Serves an aggregator at `/<name>` (HTML, `.json`, `.csv`), and saves it
 * with the persistence.
 * @param {string} name
 * @param {import('../lib/aggregator').Aggregator} aggregator
 * @param {import('./html').AggregatorViewOptions} [htmlOptions]
 */
function registerAggregator(name, aggregator, htmlOptions = {}) {
  const htmlView = html.aggregatorView(name, htmlOptions);
  persistence.register(name, aggregator);
  app.get(`/${name}{.:format}`, (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : null);
    const limit = req.query.limit || 100;
    // Unknown sorts fall back to the count of the period (?period=24h for
    // the last 24 hours, 15 minutes by default)
    const sort =
      aggregator.sorters && aggregator.sorters[String(req.query.sort)]
        ? String(req.query.sort)
        : req.query.period === '24h'
          ? 'count24h'
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
      filter: htmlOptions.identityFilter
        ? identityFilters.get(String(req.query.filter))
        : undefined,
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
}

/**
 * @template T
 * @param {T | Promise<T>} value
 * @returns {value is Promise<T>}
 */
function isPromise(value) {
  return typeof (/** @type {any} */ (value).then) === 'function';
}

/** @typedef {import('../types').Log} Log */

module.exports = Object.assign(app, { streamToHttp, registerAggregator });
