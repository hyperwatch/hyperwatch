const path = require('path');

const { fromJS } = require('immutable');

const { api } = require('../app');
const constants = require('../constants');
const LogBuffer = require('../lib/log-buffer');
const logFiles = require('../lib/log-files');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { logMatches, md5, parseNumber } = require('../lib/util');

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Node} Node */
/** @typedef {import('../lib/log-files').LogWriter} LogWriter */

/**
 * `modules.history.disk` (see docs/configuration.md)
 * @typedef {object} HistoryDiskConfig
 * @property {string} [dir] Where the nodes' directories are
 * @property {Record<string, boolean | string>} [nodes] Names or patterns,
 *   with true or "true"
 * @property {(log: Log) => Log | null} [transform] What to write of a log,
 *   or null to skip it
 * @property {(log: Log) => Log | Promise<Log>} [restore] A log read back,
 *   with what `transform` left out put back
 */

/**
 * `modules.history` (see docs/configuration.md). Values set through the
 * environment (rc) are strings
 * @typedef {import('../types').ModuleConfig & {
 *   capacity?: number | string,
 *   nodes?: Record<string, number | string>,
 *   disk?: HistoryDiskConfig,
 * }} HistoryConfig
 */

const DEFAULT_CAPACITY = 100;
// The longest array JavaScript allows
const MAX_CAPACITY = 2 ** 32 - 1;

// Log buffers per pipeline node, once started
/** @type {Record<string, LogBuffer | null>} */
const buffers = {};

// Log files per pipeline node with disk history, once started, and their
// directories
/** @type {Record<string, LogWriter>} */
const writers = {};
/** @type {Record<string, string>} */
const dirs = {};

// What is read back of a log written to disk (modules.history.disk.restore)
/** @type {HistoryDiskConfig['restore'] | null} */
let restore = null;

// At most this many reads of log files at once
const MAX_DISK_READS = 2;
let diskReads = 0;

const DEFAULT_DISK_DIR = path.join('.hyperwatch-data', 'logs');

// The aggregators whose entries are the values of each filter: the same
// keys as logMatches (an identity key, address.value, signature.id), fed
// with every log of the main node
const FILTER_AGGREGATORS = {
  identity: 'identities',
  address: 'addresses',
  signature: 'signatures',
};

// A log is written to the file of the hour it's written, a moment after the
// aggregators count it: look a few minutes past the last time seen
const LAST_SEEN_MARGIN = 5 * 60;

/**
 * When a log matching all the filters was last seen, in seconds: the
 * earliest of the last times of their aggregator entries (a log matching
 * them all matches each). null when no filter has an entry to tell, e.g. its
 * module is off, or the entry was dropped from a full aggregator.
 * @param {Record<string, unknown>} filters
 * @returns {number | null}
 */
function lastSeen(filters) {
  /** @type {number | null} */
  let earliest = null;
  for (const [key, name] of Object.entries(FILTER_AGGREGATORS)) {
    const value = filters[key];
    if (typeof value !== 'string' || !value) {
      continue;
    }
    // Aggregators key their entries by the md5 of the identifier
    const aggregator = api.getAggregator(name);
    const entry = aggregator && aggregator.get(md5(value));
    const speed = entry && entry.getIn(['speed', 'per_minute']);
    const latest =
      speed && /** @type {{ latest: number | null }} */ (speed).latest;
    if (
      typeof latest === 'number' &&
      (earliest === null || latest < earliest)
    ) {
      earliest = latest;
    }
  }
  return earliest;
}

/**
 * Whether a node's logs all go through the main node, where the aggregators
 * count them: main and the nodes made from it, not the inputs' nodes
 * @param {string} name
 * @returns {boolean}
 */
function afterMain(name) {
  const main = pipeline.nodes.main;
  const node = pipeline.nodes[name];
  if (!main || !node) {
    return false;
  }
  const queue = [main];
  const seen = new Set();
  while (queue.length) {
    const current = /** @type {Node} */ (queue.shift());
    if (current === node) {
      return true;
    }
    if (!seen.has(current)) {
      seen.add(current);
      queue.push(...current.children);
    }
  }
  return false;
}

/**
 * The newest hour of a node's log files that can hold logs matching the
 * filters, from when they were last seen, or undefined to read from the
 * newest file. Searches for a value seen hours ago start there, instead of
 * spending their bounds on the hours since.
 * @param {string} name
 * @param {Record<string, unknown>} filters
 * @returns {string | undefined}
 */
function searchStart(name, filters) {
  const seen = lastSeen(filters);
  if (seen === null || !afterMain(name)) {
    return undefined;
  }
  return logFiles.hourOf(new Date((seen + LAST_SEEN_MARGIN) * 1000));
}

// A whole number of logs, 0 included, or null. Values set through the
// environment (rc) are strings
/**
 * @param {unknown} value
 * @param {string} setting Its name, for the warning
 * @returns {number | null}
 */
function parseCapacity(value, setting) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = parseNumber(value, {
    integer: true,
    min: 0,
    max: MAX_CAPACITY,
  });
  if (number !== null) {
    return number;
  }
  console.warn(`Invalid ${setting} "${value}": using the default.`);
  return null;
}

// The setting of `nodes` for a node: its name, else the first pattern ending
// with `*` that matches (e.g. "input-*"), else undefined
/**
 * @param {string} name
 * @param {Record<string, unknown>} [nodes]
 * @returns {{ key: string, value: unknown } | undefined}
 */
function nodeSetting(name, nodes = {}) {
  if (Object.prototype.hasOwnProperty.call(nodes, name)) {
    return { key: name, value: nodes[name] };
  }
  for (const key of Object.keys(nodes)) {
    if (key.endsWith('*') && name.startsWith(key.slice(0, -1))) {
      return { key, value: nodes[key] };
    }
  }
  return undefined;
}

/**
 * The number of logs kept for a pipeline node: `nodes[name]`, else the first
 * `nodes` pattern ending with `*` that matches (e.g. "input-*"), else
 * `capacity` (100 by default). 0 keeps no history for that node.
 * @param {string} name
 * @param {HistoryConfig} [config]
 * @returns {number}
 */
function capacityFor(name, config = {}) {
  const capacity = parseCapacity(config.capacity, 'modules.history.capacity');
  const fallback = capacity === null ? DEFAULT_CAPACITY : capacity;
  const setting = nodeSetting(name, config.nodes);
  if (!setting) {
    return fallback;
  }
  const value = parseCapacity(
    setting.value,
    `modules.history.nodes.${setting.key}`
  );
  return value === null ? fallback : value;
}

/**
 * The directory where a node's logs are written, or null: only for nodes
 * set in `disk.nodes` (same patterns as `nodes`), with true or "true".
 * One directory per node in `disk.dir` (.hyperwatch-data/logs by default),
 * prefixed so that no node name leaves it.
 * @param {string} name
 * @param {HistoryConfig} [config]
 * @returns {string | null}
 */
function diskDirFor(name, config = {}) {
  const disk = config.disk;
  if (!disk) {
    return null;
  }
  const setting = nodeSetting(name, disk.nodes);
  if (!setting || (setting.value !== true && setting.value !== 'true')) {
    return null;
  }
  return path.resolve(
    disk.dir || DEFAULT_DISK_DIR,
    `node-${persistence.safeName(name)}`
  );
}

function start() {
  /** @type {HistoryConfig} */
  const config = constants.modules.history || {};
  restore =
    config.disk && typeof config.disk.restore === 'function'
      ? config.disk.restore
      : null;

  // Before the nodes' routes, so that it wins over a node named "disk"
  api.get('/history/disk.json', async (req, res) => {
    /** @type {Record<string, Awaited<ReturnType<LogWriter['stats']>>>} */
    const stats = {};
    for (const [name, writer] of Object.entries(writers)) {
      stats[name] = await writer.stats();
    }
    res.json(stats);
  });

  /**
   * @param {string} name
   * @param {Node} node
   */
  function registerNodeHistory(name, node) {
    const capacity = capacityFor(name, config);
    // 0: no buffer, so no persistence document either, and no history in
    // /history/<name>.json or the live logs
    buffers[name] = capacity ? new LogBuffer(capacity) : null;
    const buffer = buffers[name];
    if (buffer) {
      persistence.register(`history-${persistence.safeName(name)}`, buffer);
    }
    // Disk history, whatever the capacity
    const dir = diskDirFor(name, config);
    const transform = config.disk && config.disk.transform;
    const writer = dir
      ? new logFiles.LogWriter(dir, {
          transform: typeof transform === 'function' ? transform : null,
        })
      : null;
    if (writer) {
      writers[name] = writer;
      dirs[name] = /** @type {string} */ (dir);
    }
    if (buffer || writer) {
      node.map((log) => {
        if (buffer) {
          buffer.push(log);
        }
        if (writer) {
          writer.push(log);
        }
        return log;
      });
    }

    api.get(`/history/${name}.json`, async (req, res) => {
      const limit = parseInt(String(req.query.limit), 10) || 100;

      res.json(await forView(name, limit, req.query));
    });

    if (writer) {
      api.get(`/history/${name}/disk.json`, (req, res) =>
        readDisk(name, /** @type {string} */ (dir), req, res)
      );
    }
  }

  for (const [name, node] of Object.entries(pipeline.nodes)) {
    registerNodeHistory(name, node);
  }

  // Auto-register future nodes
  const originalSetNode = pipeline.setNode.bind(pipeline);
  pipeline.setNode = function (name, node) {
    const result = originalSetNode(name, node);
    if (!(name in buffers)) {
      registerNodeHistory(name, node);
    }
    return result;
  };
}

// GET /history/<node>/disk.json?identity=|address=|signature=&limit=&cursor=
/**
 * @param {string} name
 * @param {string} dir
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function readDisk(name, dir, req, res) {
  const limit =
    req.query.limit === undefined
      ? 100
      : parseNumber(req.query.limit, { integer: true, min: 1, max: 1000 });
  if (limit === null) {
    res.status(400).json({ error: 'limit must be a whole number, 1 to 1000' });
    return;
  }
  if (diskReads >= MAX_DISK_READS) {
    res.status(429).json({ error: 'Too many reads of the log files at once' });
    return;
  }
  const { identity, address, signature } =
    /** @type {Record<string, string | undefined>} */ (req.query);
  const controller = new AbortController();
  // The client left before the response: stop reading
  res.on('close', () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  const filters = { identity, address, signature };
  const cursor = /** @type {string | undefined} */ (req.query.cursor);
  // The first page starts where the filters were last seen
  const until = cursor ? undefined : searchStart(name, filters);
  diskReads++;
  try {
    const result = await logFiles.read(dir, {
      limit,
      cursor,
      filters,
      signal: controller.signal,
      until,
    });
    const logs = await restoreAll(result.logs);
    if (!controller.signal.aborted) {
      res.json({ ...result, logs, until: until || null });
    }
  } catch (err) {
    if (err instanceof logFiles.CursorError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error(
        'Error reading the log files:',
        /** @type {Error} */ (err).message
      );
      res.status(500).json({ error: 'Error reading the log files' });
    }
  } finally {
    diskReads--;
  }
}

// Ends the log files, at most `timeout` ms, then forgets them
/** @param {{ timeout?: number }} [options] */
async function flush({ timeout = 5000 } = {}) {
  const signal = AbortSignal.timeout(timeout);
  const all = Object.values(writers);
  for (const name of Object.keys(writers)) {
    delete writers[name];
  }
  await Promise.all(all.map((writer) => writer.flush(signal)));
}

// Logs read from disk, as logs again: restore (see the config) puts back
// what the transform left out. A restore that fails keeps the log as read
/**
 * @param {Record<string, any>[]} logs As read from disk
 * @returns {Promise<Log[]>}
 */
function restoreAll(logs) {
  return Promise.all(
    logs.map(async (data) => {
      const log = /** @type {Log} */ (fromJS(data));
      if (!restore) {
        return log;
      }
      try {
        return (await restore(log)) || log;
      } catch (err) {
        return log;
      }
    })
  );
}

/** @param {Record<string, any>} [filters] */
const hasFilter = (filters = {}) =>
  ['identity', 'address', 'signature'].some((key) => filters[key]);

/**
 * The history a view starts with (/history/<node>.json, /logs/<node>):
 * newest first. Filtered (?identity=, ?address=, ?signature=) on a node with
 * disk history, it's read from disk (at most 1000 logs), as a promise:
 * written logs and those still pending when the view asks, so live logs
 * received from then on follow it without a gap or a repeat. Otherwise, or
 * while 2 reads are running, or when reading fails, the latest logs in
 * memory. The read starts where the filters were last seen (searchStart).
 * searchView also says how far it searched.
 * @param {string} name
 * @param {number} limit
 * @param {Record<string, any>} filters From the query string
 * @returns {Log[] | Promise<Log[]>}
 */
function forView(name, limit, filters) {
  const result = searchView(name, limit, filters);
  return result instanceof Promise
    ? result.then(({ logs }) => logs)
    : result.logs;
}

/**
 * What a view shows of a node's past logs, and how far it searched
 * @typedef {object} ViewSearch
 * @property {Log[]} logs Newest first
 * @property {string | null} cursor Where older logs go on in the log
 *   files (a cursor of /history/<node>/disk.json), null when there are none
 *   or the files weren't read
 * @property {boolean} truncated Whether the search stopped on a bound of
 *   the read, not at the limit or the oldest log
 * @property {string | null} until The newest hour searched, when it started
 *   where the filters were last seen, else null
 * @property {string} [error] Why nothing was read, e.g. an invalid cursor
 */

/**
 * The latest logs of a node matching `filters`, for views: from the log
 * files with filters (see forView), from `cursor` when given, else from
 * where the filters were last seen
 * @param {string} name
 * @param {number} limit
 * @param {Record<string, unknown>} filters
 * @param {string} [cursor] From an earlier search
 * @returns {ViewSearch | Promise<ViewSearch>}
 */
function searchView(name, limit, filters, cursor) {
  /** @type {(logs: Log[]) => ViewSearch} */
  const memory = (logs) => ({
    logs,
    cursor: null,
    truncated: false,
    until: null,
  });
  const writer = writers[name];
  if (!writer || !hasFilter(filters) || limit <= 0) {
    return memory(latest(name, limit, filters));
  }
  if (diskReads >= MAX_DISK_READS) {
    return memory(latest(name, limit, filters));
  }
  // Now, before any live log reaches the view: what the files hold, and
  // the memory history if reading them fails (taken later, it would repeat
  // the live logs received meanwhile)
  const snapshot = cursor ? undefined : writer.snapshot();
  const fallback = memory(latest(name, limit, filters));
  const { identity, address, signature } = filters;
  const until = cursor ? undefined : searchStart(name, filters);
  diskReads++;
  return (async () => {
    try {
      const result = await logFiles.read(dirs[name], {
        limit: Math.min(limit, 1000),
        cursor,
        filters:
          /** @type {import('../lib/log-files').ReadOptions['filters']} */ ({
            identity,
            address,
            signature,
          }),
        snapshot,
        until,
      });
      return {
        logs: await restoreAll(result.logs),
        cursor: result.cursor,
        truncated: result.truncated,
        until: until || null,
      };
    } catch (err) {
      if (err instanceof logFiles.CursorError) {
        return { ...memory([]), error: err.message };
      }
      console.error(
        'Error reading the log files:',
        /** @type {Error} */ (err).message
      );
      return fallback;
    } finally {
      diskReads--;
    }
  })();
}

// The latest logs of a pipeline node matching `filters` (see logMatches),
// newest first, or [] without history
/**
 * @param {string} name
 * @param {number} limit
 * @param {Record<string, any>} [filters]
 * @returns {Log[]}
 */
function latest(name, limit, filters) {
  if (!buffers[name]) {
    return [];
  }
  return buffers[name]
    .toArray()
    .filter((log) => logMatches(log, filters))
    .slice(0, limit);
}

module.exports = {
  start,
  latest,
  forView,
  searchView,
  capacityFor,
  diskDirFor,
  flush,
};
