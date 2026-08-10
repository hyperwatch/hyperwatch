/**
 * Stream processing language.
 *
 * An event is an immutable map with the following keys:
 *
 *  time  int     required   Number of seconds since UNIX epoch.
 *  data  any     required   An event's data.
 *  key   string  optional   A way to group events together
 *
 * This modules provides functions to build a pipeline, a tree of stream processors.
 */
const Ajv = require('ajv').default;
const addFormats = require('ajv-formats').default;
const { Map } = require('immutable');

const schema = require('../format/log-schema.json');

const monitoring = require('./monitoring');
const { complement } = require('./util');

const validator = new Ajv();
addFormats(validator);

const validate = validator.compile(schema);

function errorLog(log, severity = 'warn') {
  console[severity](log);
  if (severity === 'error') {
    console.trace(log);
  }
}

/**
 * Forward an event to a stream.
 */
function forward(stream, event) {
  try {
    stream(event);
  } catch (reason) {
    errorLog(reason, 'warn');
  }
}

/**
 * Identity stream transformer.
 */
function identity() {
  return (stream) => stream;
}

/**
 * Applies `f` to each event.
 *
 * `f` can return an event or a Promise of an event.
 */
function map(f) {
  return (stream) => {
    return (event) => {
      const res = f(event.get('data'));
      if (res && res.then) {
        res
          .then((value) => forward(stream, event.set('data', value)))
          .catch((reason) => errorLog(reason, 'warn'));
      } else {
        forward(stream, event.set('data', res));
      }
    };
  };
}

/**
 * Forward events if `pred(event)` returns true.
 */
function filter(pred) {
  return (stream) => {
    return (event) => {
      if (pred(event.get('data'))) {
        forward(stream, event);
      }
    };
  };
}

/**
 * Compose stream transformers sequentially.
 */
function comp(xfes) {
  const xfes_ = xfes.slice().reverse();
  return (stream) => {
    return xfes_.reduce((stream, xf) => xf(stream), stream);
  };
}

/**
 * Compose stream transformers in parallel.
 */
function multiplex(xfes) {
  return (stream) => {
    const streams = xfes.map((xf) => xf(stream));
    return (event) => {
      streams.map((stream) => forward(stream, event));
    };
  };
}

/**
 * Logically split the stream for each unique value of `f(event)`.
 *
 * Ignore `undefined` values.
 */
function by(f) {
  return (stream) => {
    return (event) => {
      const value = f(event.get('data'));
      if (value !== undefined) {
        forward(stream, event.set('key', value));
      }
    };
  };
}

/**
 * Pipeline builder
 */
class Builder {
  constructor(xf, pipeline = null) {
    this.xf = xf;
    this.children = [];
    this.name = null;
    this.pipeline = pipeline;
    this.parent = null;
    this.op = null;
    this.module = null;
    this.fnName = null;
    this._label = null;
    // Lightweight per-node counter for throughput tracking
    this.counter = 0;
    this.rateWindow = []; // timestamps of recent events for rate calculation
  }

  add(xf, { op = null, fnName = null, label = null } = {}) {
    const child = new Builder(xf, this.pipeline);
    child.parent = this;
    child.op = op;
    child.module = this.pipeline ? this.pipeline.currentModule : null;
    child.fnName = fnName || null;
    child._label = label || null;
    this.children.push(child);
    return child;
  }

  map(f, label) {
    return this.add(map(f), { op: 'map', fnName: f.name, label });
  }

  filter(pred, label) {
    return this.add(filter(pred), { op: 'filter', fnName: pred.name, label });
  }

  split(pred, labels) {
    return [
      this.add(filter(pred), {
        op: 'split-true',
        fnName: pred.name,
        label: labels && labels[0],
      }),
      this.add(filter(complement(pred)), {
        op: 'split-false',
        fnName: pred.name,
        label: labels && labels[1],
      }),
    ];
  }

  by(f, label) {
    return this.add(by(f), { op: 'by', fnName: f.name, label });
  }

  create() {
    const self = this;
    const countXf = (stream) => (event) => {
      self.counter++;
      const now = Date.now();
      self.rateWindow.push(now);
      // Keep only last 10 seconds of timestamps
      while (self.rateWindow.length > 0 && self.rateWindow[0] < now - 10000) {
        self.rateWindow.shift();
      }
      forward(stream, event);
    };
    if (this.children.length === 0) {
      return comp([this.xf, countXf]);
    }
    return comp([
      this.xf,
      countXf,
      multiplex(this.children.map((b) => b.create())),
    ]);
  }

  // Helpers

  registerNode(name, { monitor = false } = {}) {
    this.pipeline.registerNode(name, this);
    this.name = name;
    if (monitor) {
      this.monitorNode();
    }
    return this;
  }

  monitorNode() {
    const monitor = monitoring.register({
      name: `Pipeline node (${this.name})`,
      status: 'Processing',
      speeds: ['processed'],
      type: 'node',
    });
    this.pipeline.monitors.push(monitor);
    this.map(() => monitor.hit());
    return this;
  }
}

class Pipeline extends Builder {
  constructor() {
    super(identity());
    this.inputs = [];
    this.monitors = [];
    this.stream = null;
    this.nodes = {
      raw: this,
      main: this,
    };
    this.pipeline = this;
    this.name = 'raw';
    this.currentModule = null;
    this.op = 'identity';
  }

  registerInput(input) {
    this.inputs.push(input);
    const monitor = monitoring.register({
      name: input.name,
      speeds: ['accepted', 'rejected'],
      type: 'input',
    });
    this.monitors.push(monitor);
    // Create a tap node so this input gets its own /logs/ WebSocket endpoint
    const inputIndex = this.inputs.length;
    const nodeName = `input-${inputIndex}`;
    const tap = new Builder(identity(), this);
    tap.name = nodeName;
    tap.op = 'input';
    tap.module = null;
    tap.fnName = null;
    this.registerNode(nodeName, tap);
    input._tap = tap;
  }

  start() {
    const stream = super.create()(() => {});

    this.inputs.map((input) => {
      const monitor = this.monitors.find(
        (monitor) => monitor.type === 'input' && monitor.name === input.name
      );
      // Build the tap stream so it can forward logs to WebSocket clients
      const tapStream = input._tap ? input._tap.create()(() => {}) : null;
      input.start({
        success: (log) => {
          const valid = validate(log.toJS());
          if (valid) {
            const event = Map({
              time: Math.floor(
                new Date(log.getIn(['request', 'time'])).getTime() / 1000
              ),
              data: log,
            });
            monitor.hit('accepted');
            if (tapStream) {
              forward(tapStream, event);
            }
            forward(stream, event);
          } else {
            monitor.hit('rejected');
            errorLog(
              `Invalid message: ${validator.errorsText(validate.errors)}`,
              'warn'
            );
          }
        },
        reject: (reason) => {
          monitor.hit('rejected');
          errorLog(reason, 'warn');
        },
        status: (err, msg) => {
          if (err) {
            console.error(err);
          }
          console.log(`${input.name}: ${msg}`);
          monitor.status = msg;
        },
        log: errorLog,
      });
    });
  }

  stop() {
    return Promise.all(
      this.inputs.filter((input) => input.stop).map((input) => input.stop())
    );
  }

  registerNode(name, node) {
    const previous = this.nodes[name];
    if (previous && previous !== node && previous.name === name) {
      previous.name = null;
    }
    this.nodes[name] = node;
  }

  getNode(name) {
    return this.nodes[name];
  }

  getTree(node = this) {
    const now = Date.now();
    // Trim stale timestamps before computing rate
    while (node.rateWindow.length > 0 && node.rateWindow[0] < now - 10000) {
      node.rateWindow.shift();
    }
    const obj = {
      name: node.name || null,
      op: node.op || null,
      module: node.module || null,
      fnName: node.fnName || null,
      label: node._label || null,
      count: node.counter,
      rate: node.rateWindow.length / 10, // events per second (10s window)
      children: node.children.map((child) => this.getTree(child)),
    };
    // Include inputs at the root level
    if (node === this) {
      obj.inputs = this.inputs.map((input) => {
        const monitor = this.monitors.find(
          (m) => m.type === 'input' && m.name === input.name
        );
        const accepted = monitor
          ? monitor.speeds.accepted.per_minute.compute()
          : null;
        const rejected = monitor
          ? monitor.speeds.rejected.per_minute.compute()
          : null;
        return {
          name: input.name,
          node: input._tap ? input._tap.name : null,
          status: monitor ? monitor.status : null,
          accepted: accepted ? accepted.reduce((a, b) => a + b, 0) : 0,
          rejected: rejected ? rejected.reduce((a, b) => a + b, 0) : 0,
        };
      });
    }
    return obj;
  }
}

module.exports = new Pipeline();
