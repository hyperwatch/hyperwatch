const { api } = require('../app');
const constants = require('../constants');
const LogBuffer = require('../lib/log-buffer');
const persistence = require('../lib/persistence');
const pipeline = require('../lib/pipeline');

function start() {
  const capacity =
    (constants.modules.history && constants.modules.history.capacity) || 1000;
  const buffers = {};

  function registerNodeHistory(name, node) {
    const buffer = new LogBuffer(capacity);
    buffers[name] = buffer;
    persistence.register(`history-${persistence.safeName(name)}`, buffer);

    node.map((log) => {
      buffer.push(log);
      return log;
    });

    api.get(`/history/${name}.json`, (req, res) => {
      const { identity, signature, address } = req.query;
      const limit = parseInt(req.query.limit, 10) || 100;

      let logs = buffer.toArray();

      if (identity) {
        logs = logs.filter((log) => log.get('identity') === identity);
      }
      if (signature) {
        logs = logs.filter(
          (log) => log.getIn(['signature', 'id']) === signature
        );
      }
      if (address) {
        logs = logs.filter(
          (log) => log.getIn(['address', 'value']) === address
        );
      }

      logs = logs.slice(0, limit);

      res.json(logs);
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

module.exports = { start };
