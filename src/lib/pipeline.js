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

/**
 * @param {unknown} log
 * @param {Severity} [severity]
 */
function errorLog(log, severity = 'warn') {
  console[severity](log);
  if (severity === 'error') {
    console.trace(log);
  }
}

/**
 * Forward an event to a stream.
 * @param {Stream} stream
 * @param {Event} event
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
 * @returns {Transformer}
 */
function identity() {
  return (stream) => stream;
}

/**
 * Applies `f` to each event.
 *
 * `f` can return an event or a Promise of an event.
 * @param {(log: Log) => any} f
 * @returns {Transformer}
 */
function map(f) {
  return (stream) => {
    return (event) => {
      const res = f(event.get('data'));
      if (res && res.then) {
        res
          .then((/** @type {unknown} */ value) =>
            forward(stream, event.set('data', value))
          )
          .catch((/** @type {unknown} */ reason) => errorLog(reason, 'warn'));
      } else {
        forward(stream, event.set('data', res));
      }
    };
  };
}

/**
 * Forward events if `pred(event)` returns true.
 * @param {(log: Log) => unknown} pred
 * @returns {Transformer}
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
 * @param {Transformer[]} xfes
 * @returns {Transformer}
 */
function comp(xfes) {
  const xfes_ = xfes.slice().reverse();
  return (stream) => {
    return xfes_.reduce((stream, xf) => xf(stream), stream);
  };
}

/**
 * Compose stream transformers in parallel.
 * @param {Transformer[]} xfes
 * @returns {Transformer}
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
 * @param {(log: Log) => unknown} f
 * @returns {Transformer}
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
 * Pipeline builder: a node of the pipeline. `map()`, `filter()`, `split()`
 * and `by()` add a child node and return it.
 */
class Builder {
  /**
   * @param {Transformer} xf
   * @param {Pipeline | null} [pipeline] The root (null for the root itself,
   *   which sets it after)
   */
  constructor(xf, pipeline = null) {
    this.xf = xf;
    /** @type {Builder[]} */
    this.children = [];
    /** @type {string | null} */
    this.name = null;
    this.pipeline = pipeline;
    /** @type {Builder | null} */
    this.parent = null;
    /** @type {string | null} `map`, `filter`, `split-true`… */
    this.op = null;
    /** @type {string | null} The module that added the node */
    this.module = null;
    /** @type {string | null} */
    this.fnName = null;
    /** @type {string | null} */
    this._label = null;
    // Lightweight per-node counter for throughput tracking
    this.counter = 0;
    // Fixed one-second buckets keep rate tracking bounded and O(1) per event.
    /** @type {Array<{ second: number | null, count: number }>} */
    this.rateBuckets = Array.from({ length: 10 }, () => ({
      second: null,
      count: 0,
    }));
  }

  /**
   * @param {Transformer} xf
   * @param {{ op?: string | null, fnName?: string | null, label?: string | null }} [options]
   * @returns {Builder}
   */
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

  /**
   * A child node with the result of `f` for each log (or a promise of it)
   * @param {(log: Log) => any} f
   * @param {string} [label] Shown in the pipeline tree
   * @returns {Builder}
   */
  map(f, label) {
    return this.add(map(f), { op: 'map', fnName: f.name, label });
  }

  /**
   * A child node with the logs for which `pred` is true
   * @param {(log: Log) => any} pred
   * @param {string} [label] Shown in the pipeline tree
   * @returns {Builder}
   */
  filter(pred, label) {
    return this.add(filter(pred), { op: 'filter', fnName: pred.name, label });
  }

  /**
   * Two child nodes: the logs for which `pred` is true, and the others
   * @param {(log: Log) => any} pred
   * @param {[string, string]} [labels] Shown in the pipeline tree
   * @returns {[Builder, Builder]}
   */
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

  /**
   * @param {(log: Log) => any} f
   * @param {string} [label] Shown in the pipeline tree
   * @returns {Builder}
   */
  by(f, label) {
    return this.add(by(f), { op: 'by', fnName: f.name, label });
  }

  /**
   * The stream transformer of this node and its children
   * @returns {Transformer}
   */
  create() {
    const self = this;
    /** @type {Transformer} */
    const countXf = (stream) => (event) => {
      self.counter++;
      const second = Math.floor(Date.now() / 1000);
      const bucket = self.rateBuckets[second % self.rateBuckets.length];
      if (bucket.second !== second) {
        bucket.second = second;
        bucket.count = 0;
      }
      bucket.count++;
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

  /**
   * Names this node: `pipeline.getNode(name)`, `/logs/<name>`
   * @param {string} name
   * @param {{ monitor?: boolean }} [options] `monitor`: on the status page
   * @returns {this}
   */
  registerNode(name, { monitor = false } = {}) {
    /** @type {Pipeline} */ (this.pipeline).setNode(name, this);
    this.name = name;
    if (monitor) {
      this.monitorNode();
    }
    return this;
  }

  /**
   * Shows this node's throughput on the status page
   * @returns {this}
   */
  monitorNode() {
    const monitor = monitoring.register({
      name: `Pipeline node (${this.name})`,
      status: 'Processing',
      speeds: ['processed'],
      type: 'node',
    });
    /** @type {Pipeline} */ (this.pipeline).monitors.push(monitor);
    this.map(() => monitor.hit());
    return this;
  }
}

class Pipeline extends Builder {
  constructor() {
    super(identity());
    /** @type {Input[]} */
    this.inputs = [];
    /** @type {MonitoringItem[]} */
    this.monitors = [];
    /** @type {Stream | null} */
    this.stream = null;
    // Once stopping, logs from any input are dropped: many inputs (HTTP,
    // syslog, file) have no stop(), and the final snapshot must be final
    this.stopped = false;
    /** @type {Record<string, Builder>} */
    this.nodes = {
      raw: this,
      main: this,
    };
    this.pipeline = this;
    this.name = 'raw';
    /** @type {string | null} The module being loaded, see Builder#module */
    this.currentModule = null;
    this.op = 'identity';
  }

  /** @param {Input} input */
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
    this.setNode(nodeName, tap);
    input._tap = tap;
  }

  /** Builds the streams and starts the inputs */
  start() {
    this.stopped = false;
    const stream = super.create()(() => {});

    this.inputs.map((input) => {
      // registerInput() registered it
      const monitor = /** @type {MonitoringItem} */ (
        this.monitors.find(
          (monitor) => monitor.type === 'input' && monitor.name === input.name
        )
      );
      // Build the tap stream so it can forward logs to WebSocket clients
      const tapStream = input._tap ? input._tap.create()(() => {}) : null;
      input.start({
        success: (log) => {
          if (this.stopped) {
            return;
          }
          const valid = validate(log.toJS());
          if (valid) {
            const event = /** @type {Event} */ (
              Map({
                time: Math.floor(
                  new Date(
                    /** @type {string} */ (log.getIn(['request', 'time']))
                  ).getTime() / 1000
                ),
                data: log,
              })
            );
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

  // Stops every input, even if some of them throw or reject, then rejects
  // with their errors if any failed
  async stop() {
    this.stopped = true;
    const results = await Promise.allSettled(
      this.inputs
        .filter((input) => input.stop)
        .map((input) =>
          Promise.resolve().then(() =>
            /** @type {Required<Input>} */ (input).stop()
          )
        )
    );
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} input(s) failed to stop: ${errors
          .map((err) => err.message)
          .join('; ')}`
      );
    }
  }

  /**
   * Names this node, like Builder#registerNode. Also accepts a node as
   * second argument, as in 5.6.0: `pipeline.registerNode(name, node)`
   * is `node.registerNode(name)` without its options.
   * @override
   * @param {string} name
   * @param {{ monitor?: boolean } | Builder} [options]
   * @returns {this}
   */
  registerNode(name, options) {
    if (options instanceof Builder) {
      this.setNode(name, options);
      return this;
    }
    return super.registerNode(name, options);
  }

  /**
   * The node registry: `getNode(name)` returns `node` from now on. Called by
   * Builder#registerNode; modules wrap it to follow new nodes (history).
   * @param {string} name
   * @param {Builder} node
   * @returns {this}
   */
  setNode(name, node) {
    const previous = this.nodes[name];
    if (previous && previous !== node && previous.name === name) {
      previous.name = null;
    }
    this.nodes[name] = node;
    return this;
  }

  /**
   * @param {string} name
   * @returns {Builder}
   */
  getNode(name) {
    return this.nodes[name];
  }

  /**
   * The pipeline's nodes from `node`, with their counts and rates
   * @param {Builder} [node]
   * @returns {TreeNode}
   */
  getTree(node = this) {
    const second = Math.floor(Date.now() / 1000);
    const windowStart = second - node.rateBuckets.length + 1;
    const rateCount = node.rateBuckets.reduce(
      (count, bucket) =>
        // null (an unused bucket) compares as 0: never in the window
        /** @type {number} */ (bucket.second) >= windowStart &&
        /** @type {number} */ (bucket.second) <= second
          ? count + bucket.count
          : count,
      0
    );
    /** @type {TreeNode} */
    const obj = {
      name: node.name || null,
      op: node.op || null,
      module: node.module || null,
      fnName: node.fnName || null,
      label: node._label || null,
      count: node.counter,
      rate: rateCount / node.rateBuckets.length,
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
          tree: input._tap ? this.getTree(input._tap) : null,
          status: monitor ? monitor.status : null,
          accepted: accepted ? accepted.reduce((a, b) => a + b, 0) : 0,
          rejected: rejected ? rejected.reduce((a, b) => a + b, 0) : 0,
        };
      });
    }
    return obj;
  }
}

/**
 * A node of the pipeline
 * @typedef {Builder} Node
 */

/**
 * The pipeline: its root node (`raw`, also `main` unless replaced), its
 * inputs and its named nodes
 * @typedef {Pipeline} Root
 */

/**
 * An input: `start()` receives the handlers to call for each log
 * (`success(log)`), invalid line (`reject(reason)`) and status change
 * (`status(err, message)`).
 * @typedef {object} Input
 * @property {string} name
 * @property {(handlers: InputHandlers) => void} start
 * @property {() => any} [stop]
 * @property {Builder} [_tap]
 */

/**
 * @typedef {object} InputHandlers
 * @property {(log: Log) => void} success
 * @property {(reason: unknown) => void} reject
 * @property {(err: unknown, message: string) => void} status
 * @property {(message: unknown, severity?: Severity) => void} log
 */

/**
 * A console method
 * @typedef {'error' | 'warn' | 'info' | 'log' | 'debug'} Severity
 */

/**
 * An event: an Immutable Map with `time` (seconds since the epoch), `data`
 * (the log) and an optional `key` (see `by()`)
 * @typedef {import('immutable').Map<string, any>} Event
 */

/**
 * Receives the events of a node
 * @typedef {(event: Event) => void} Stream
 */

/**
 * A stream transformer: given the stream of the next nodes, the stream of
 * this one
 * @typedef {(stream: Stream) => Stream} Transformer
 */

/**
 * A node of the pipeline tree (getTree()), with its count and rate per
 * second over the last 10 seconds
 * @typedef {object} TreeNode
 * @property {string | null} name
 * @property {string | null} op
 * @property {string | null} module
 * @property {string | null} fnName
 * @property {string | null} label
 * @property {number} count
 * @property {number} rate
 * @property {TreeNode[]} children
 * @property {TreeInput[]} [inputs] At the root only
 */

/**
 * An input in the pipeline tree, with its counts over the last 15 minutes
 * @typedef {object} TreeInput
 * @property {string} name
 * @property {string | null} node
 * @property {TreeNode | null} tree
 * @property {string | null} status
 * @property {number} accepted
 * @property {number} rejected
 */

/** @typedef {import('./monitoring').MonitoringItem} MonitoringItem */
/** @typedef {import('../types').Log} Log */

module.exports = new Pipeline();
