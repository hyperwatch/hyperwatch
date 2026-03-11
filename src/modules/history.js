const constants = require('../constants');
const { api } = require('../app');
const pipeline = require('../lib/pipeline');

class CircularBuffer {
  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.pointer = 0;
    this.size = 0;
  }

  push(item) {
    this.buffer[this.pointer] = item;
    this.pointer = (this.pointer + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  toArray() {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size).reverse();
    }
    return [
      ...this.buffer.slice(this.pointer),
      ...this.buffer.slice(0, this.pointer),
    ].reverse();
  }
}

function start() {
  const capacity =
    (constants.modules.history && constants.modules.history.capacity) || 1000;
  const buffers = {};

  function registerNodeHistory(name, node) {
    const buffer = new CircularBuffer(capacity);
    buffers[name] = buffer;

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
