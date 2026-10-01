const { api } = require('../app');
const constants = require('../constants');
const LogBuffer = require('../lib/log-buffer');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { logMatches } = require('../lib/util');

const DEFAULT_CAPACITY = 1000;

// Log buffers per pipeline node, once started
const buffers = {};

// A whole number of logs, 0 included, or null. Values set through the
// environment (rc) are strings
function parseCapacity(value, setting) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const number = Number(value);
  if (Number.isInteger(number) && number >= 0) {
    return number;
  }
  console.warn(`Invalid ${setting} "${value}": using the default.`);
  return null;
}

/**
 * The number of logs kept for a pipeline node: `nodes[name]`, else the first
 * `nodes` pattern ending with `*` that matches (e.g. "input-*"), else
 * `capacity` (1000 by default). 0 keeps no history for that node.
 */
function capacityFor(name, config = {}) {
  const capacity = parseCapacity(config.capacity, 'modules.history.capacity');
  const fallback = capacity === null ? DEFAULT_CAPACITY : capacity;
  const nodes = config.nodes || {};
  const setting = (key) => {
    const value = parseCapacity(nodes[key], `modules.history.nodes.${key}`);
    return value === null ? fallback : value;
  };

  if (Object.prototype.hasOwnProperty.call(nodes, name)) {
    return setting(name);
  }
  for (const key of Object.keys(nodes)) {
    if (key.endsWith('*') && name.startsWith(key.slice(0, -1))) {
      return setting(key);
    }
  }
  return fallback;
}

function start() {
  const config = constants.modules.history || {};

  function registerNodeHistory(name, node) {
    const capacity = capacityFor(name, config);
    // 0: no buffer, so no persistence document either, and no history in
    // /history/<name>.json or the live logs
    buffers[name] = capacity ? new LogBuffer(capacity) : null;
    if (buffers[name]) {
      const buffer = buffers[name];
      persistence.register(`history-${persistence.safeName(name)}`, buffer);
      node.map((log) => {
        buffer.push(log);
        return log;
      });
    }

    api.get(`/history/${name}.json`, (req, res) => {
      const limit = parseInt(req.query.limit, 10) || 100;

      res.json(latest(name, limit, req.query));
    });
  }

  for (const [name, node] of Object.entries(pipeline.nodes)) {
    registerNodeHistory(name, node);
  }

  // Auto-register future nodes
  const originalRegisterNode = pipeline.registerNode.bind(pipeline);
  pipeline.registerNode = function (name, node) {
    originalRegisterNode(name, node);
    if (!(name in buffers)) {
      registerNodeHistory(name, node);
    }
  };
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

module.exports = { start, latest, capacityFor };
