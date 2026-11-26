const crypto = require('crypto');

const { stringify } = require('csv-stringify/sync');
const express = require('express');

const monitoring = require('../lib/monitoring');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const {
  escapeHtml,
  fillHost,
  logMatches,
  parseNumber,
} = require('../lib/util');
const version = require('../version');

const html = require('./html');
const liveStreams = require('./live-streams');
const memory = require('./memory');
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

// What holds memory: process, heap, aggregators and history (JSON only)
app.get('/memory.json', memory.handler);

// The pipeline tree: inputs, nodes and what runs on them
html.registerSection('pipeline');
app.get('/pipeline', (req, res) => {
  /** @param {string} status */
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
 * @property {(limit: number, filters: Record<string, any>) => HistoryResult | Promise<HistoryResult>} [history]
 *   The latest logs matching the filters (the query string), newest first,
 *   shown before live ones, or a search of them (see history.searchView),
 *   whose cursor and bounds a notice shows under them
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
  // [req, res, queue] by request id, see below
  /** @type {Record<string, [Request, Response, Log[] | null]>} */
  const requests = {};

  /** @type {import('../lib/monitoring').MonitoringItem | undefined} */
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
  /**
   * @param {Request} req
   * @param {Response} res
   * @param {Log} log
   */
  const writeLog = (req, res, log) => {
    if (!logMatches(log, req.query)) {
      return;
    }
    const grep = /** @type {string | undefined} */ (req.query.grep);
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
    liveStreams.open.add(res);
    updateMonitoringStatus();

    const close = () => {
      delete requests[requestId];
      liveStreams.open.delete(res);
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
      const result = history(limit >= 0 ? limit : 100, req.query);
      if (isPromise(result)) {
        /** @type {Log[]} */
        const queue = [];
        requests[requestId][2] = queue;
        result
          .catch((err) => {
            console.error(`Error reading the history of ${endpoint}:`, err);
            return /** @type {Log[]} */ ([]);
          })
          .then((read) => {
            if (res.writableEnded || res.destroyed) {
              return;
            }
            const search = Array.isArray(read) ? { logs: read } : read;
            for (const log of [...search.logs].reverse()) {
              writeLog(req, res, log);
            }
            res.write(html.streamSearchNotice(req, search));
            for (const log of queue) {
              writeLog(req, res, log);
            }
            if (requests[requestId]) {
              requests[requestId][2] = null;
            }
          });
      } else {
        const search = Array.isArray(result) ? { logs: result } : result;
        for (const log of [...search.logs].reverse()) {
          writeLog(req, res, log);
        }
        res.write(html.streamSearchNotice(req, search));
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
/** @type {Map<string, (entry: import('../lib/aggregator').Entry) => boolean>} */
const identityFilters = new Map([
  ['identified', (entry) => !!entry.get('identity')],
  ['unidentified', (entry) => !entry.get('identity')],
]);

// Aggregators registered, by name
/** @type {Map<string, import('../lib/aggregator').Aggregator>} */
const aggregators = new Map();

/**
 * An aggregator registered with registerAggregator, by name
 * @param {string} name
 * @returns {import('../lib/aggregator').Aggregator | undefined}
 */
const getAggregator = (name) => aggregators.get(name);

// Aggregator name by persistence name: graphql/v1 and graphql_2f_v1 can't
// both be registered
/** @type {Map<string, string>} */
const persistenceNames = new Map();

/**
 * Whether an aggregator is registered under this path
 * @param {string} path
 * @param {boolean} caseSensitive
 */
function hasAggregator(path, caseSensitive) {
  if (caseSensitive) {
    return aggregators.has(path);
  }
  const lower = path.toLowerCase();
  return [...aggregators.keys()].some((name) => name.toLowerCase() === lower);
}

// Segments of letters, digits, '.', '_' and '-', separated by '/'
const AGGREGATOR_NAME = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/**
 * Serves an aggregator at `/<name>` (HTML, `.json`, `.csv`), and saves it
 * with the persistence. The name may contain '/' (graphql/v1), but not
 * under a built-in page (logs/…).
 * @param {string} name
 * @param {import('../lib/aggregator').Aggregator} aggregator
 * @param {import('./html').AggregatorViewOptions} [htmlOptions]
 */
function registerAggregator(name, aggregator, htmlOptions = {}) {
  if (!AGGREGATOR_NAME.test(name)) {
    throw new Error(`Invalid aggregator name: "${name}"`);
  }
  if (html.isUnderBuiltIn(name)) {
    throw new Error(`The ${name} aggregator is under a built-in page`);
  }
  // Names without '/' keep their document; graphql/v1 is saved as
  // graphql_2f_v1
  const persistenceName = name.includes('/')
    ? persistence.safeName(name)
    : name;
  const other = persistenceNames.get(persistenceName);
  if (other !== undefined && other !== name) {
    throw new Error(
      `The ${name} aggregator would be saved as the ${other} aggregator`
    );
  }
  const htmlView = html.aggregatorView(name, htmlOptions);
  aggregators.set(name, aggregator);
  persistenceNames.set(persistenceName, name);
  persistence.register(persistenceName, aggregator);
  app.get(`/${name}{.:format}`, (req, res) => {
    const raw = req.query.raw ? true : false;
    const format = req.params.format || (raw ? 'json' : null);
    // A whole number from 1, else the default (?limit=abc used to return
    // nothing, ?limit=-5 all but the last 5)
    const parsedLimit = parseNumber(req.query.limit, {
      integer: true,
      min: 1,
    });
    const limit = parsedLimit === null ? 100 : parsedLimit;
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
      // The query's value as is (a string when given)
      limit: /** @type {number} */ (limit),
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
        `attachment; filename="${name.replaceAll('/', '-')}.csv"`
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

  app.get(`/${name}/:identifier{.json}`, (req, res, next) => {
    // The page of another aggregator (graphql/v1 under graphql, in any
    // format), whichever registered first. From the path: {.json} takes the
    // suffix off the identifier, and a name may end in .json
    // As the router matches: without the trailing slash and the case, unless
    // strict or case sensitive routing is on
    const caseSensitive = req.app.enabled('case sensitive routing');
    let nested = req.path.slice(1);
    if (!req.app.enabled('strict routing')) {
      nested = nested.replace(/\/$/, '');
    }
    const format = nested.match(/\.(?:json|csv)$/);
    if (
      hasAggregator(nested, caseSensitive) ||
      (format && hasAggregator(nested.slice(0, format.index), caseSensitive))
    ) {
      next();
      return;
    }
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
/**
 * @typedef {Log[] | import('../modules/history').ViewSearch} HistoryResult
 */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

module.exports = Object.assign(app, {
  streamToHttp,
  registerAggregator,
  getAggregator,
});
