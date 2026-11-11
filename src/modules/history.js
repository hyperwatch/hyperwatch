const path = require('path');

const { fromJS } = require('immutable');

const { api } = require('../app');
const constants = require('../constants');
const LogBuffer = require('../lib/log-buffer');
const logFiles = require('../lib/log-files');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { logMatches, parseNumber } = require('../lib/util');

const DEFAULT_CAPACITY = 100;
// The longest array JavaScript allows
const MAX_CAPACITY = 2 ** 32 - 1;

// Log buffers per pipeline node, once started
const buffers = {};

// Log files per pipeline node with disk history, once started, and their
// directories
const writers = {};
const dirs = {};

// What is read back of a log written to disk (modules.history.disk.restore)
let restore = null;

// At most this many reads of log files at once
const MAX_DISK_READS = 2;
let diskReads = 0;

const DEFAULT_DISK_DIR = path.join('.hyperwatch-data', 'logs');

// A whole number of logs, 0 included, or null. Values set through the
// environment (rc) are strings
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
  const config = constants.modules.history || {};
  restore =
    config.disk && typeof config.disk.restore === 'function'
      ? config.disk.restore
      : null;

  // Before the nodes' routes, so that it wins over a node named "disk"
  api.get('/history/disk.json', async (req, res) => {
    const stats = {};
    for (const [name, writer] of Object.entries(writers)) {
      stats[name] = await writer.stats();
    }
    res.json(stats);
  });

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
      dirs[name] = dir;
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
        readDisk(dir, req, res)
      );
    }
  }

  for (const [name, node] of Object.entries(pipeline.nodes)) {
    registerNodeHistory(name, node);
  }

  // Auto-register future nodes
  const originalRegisterNode = pipeline.registerNode.bind(pipeline);
  pipeline.registerNode = function (name, node) {
    const result = originalRegisterNode(name, node);
    if (!(name in buffers)) {
      registerNodeHistory(name, node);
    }
    return result;
  };
}

// GET /history/<node>/disk.json?identity=|address=|signature=&limit=&cursor=
async function readDisk(dir, req, res) {
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
  const { identity, address, signature } = req.query;
  const controller = new AbortController();
  // The client left before the response: stop reading
  res.on('close', () => {
    if (!res.writableFinished) {
      controller.abort();
    }
  });
  diskReads++;
  try {
    const result = await logFiles.read(dir, {
      limit,
      cursor: req.query.cursor,
      filters: { identity, address, signature },
      signal: controller.signal,
    });
    const logs = await restoreAll(result.logs);
    if (!controller.signal.aborted) {
      res.json({ ...result, logs });
    }
  } catch (err) {
    if (err instanceof logFiles.CursorError) {
      res.status(400).json({ error: err.message });
    } else {
      console.error('Error reading the log files:', err.message);
      res.status(500).json({ error: 'Error reading the log files' });
    }
  } finally {
    diskReads--;
  }
}

// Ends the log files, at most `timeout` ms, then forgets them
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
function restoreAll(logs) {
  return Promise.all(
    logs.map(async (data) => {
      const log = fromJS(data);
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

const hasFilter = (filters = {}) =>
  ['identity', 'address', 'signature'].some((key) => filters[key]);

/**
 * The history a view starts with (/history/<node>.json, /logs/<node>):
 * newest first. Filtered (?identity=, ?address=, ?signature=) on a node with
 * disk history, it's read from disk (at most 1000 logs), as a promise:
 * written logs and those still pending when the view asks, so live logs
 * received from then on follow it without a gap or a repeat. Otherwise, or
 * while 2 reads are running, or when reading fails, the latest logs in
 * memory.
 */
function forView(name, limit, filters) {
  const writer = writers[name];
  if (!writer || !hasFilter(filters) || limit <= 0) {
    return latest(name, limit, filters);
  }
  if (diskReads >= MAX_DISK_READS) {
    return latest(name, limit, filters);
  }
  // Now, before any live log reaches the view: what the files hold, and
  // the memory history if reading them fails (taken later, it would repeat
  // the live logs received meanwhile)
  const snapshot = writer.snapshot();
  const fallback = latest(name, limit, filters);
  const { identity, address, signature } = filters;
  diskReads++;
  return (async () => {
    try {
      const { logs } = await logFiles.read(dirs[name], {
        limit: Math.min(limit, 1000),
        filters: { identity, address, signature },
        snapshot,
      });
      return await restoreAll(logs);
    } catch (err) {
      console.error('Error reading the log files:', err.message);
      return fallback;
    } finally {
      diskReads--;
    }
  })();
}

// The latest logs of a pipeline node matching `filters` (see logMatches),
// newest first, or [] without history
function latest(name, limit, filters) {
  if (!buffers[name]) {
    return [];
  }
  return buffers[name]
    .toArray()
    .filter((log) => logMatches(log, filters))
    .slice(0, limit);
}

module.exports = { start, latest, forView, capacityFor, diskDirFor, flush };
