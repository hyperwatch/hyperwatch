const { api } = require('../app');
const constants = require('../constants');
const LogBuffer = require('../lib/log-buffer');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');
const { logMatches } = require('../lib/util');

// Log buffers per pipeline node, once started
const buffers = {};

function start() {
  const capacity =
    (constants.modules.history && constants.modules.history.capacity) || 1000;

  function registerNodeHistory(name, node) {
    const buffer = new LogBuffer(capacity);
    buffers[name] = buffer;
    persistence.register(`history-${persistence.safeName(name)}`, buffer);

    node.map((log) => {
      buffer.push(log);
      return log;
    });

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
    if (!buffers[name]) {
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

module.exports = { start, latest };
