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
const Ajv = require('ajv');
const { Map } = require('immutable');
const { complement } = require('./util');
const monitoring = require('./monitoring');

const schema = require('../format/log-schema.json');
const validator = new Ajv();
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
  }

  add(xf) {
    const child = new Builder(xf, this.pipeline);
    this.children.push(child);
    return child;
  }

  map(f) {
    return this.add(map(f));
  }

  filter(pred) {
    return this.add(filter(pred));
  }

  split(pred) {
    return [this.add(filter(pred)), this.add(filter(complement(pred)))];
  }

  by(f) {
    return this.add(by(f));
  }

  create() {
    if (this.children.length === 0) {
      return this.xf;
    }
    return comp([this.xf, multiplex(this.children.map((b) => b.create()))]);
  }

  // Helpers

  registerNode(name, { monitor = true } = {}) {
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
      root: this,
      main: this,
    };
    this.pipeline = this;
  }

  registerInput(input) {
    this.inputs.push(input);
    const monitor = monitoring.register({
      name: input.name,
      speeds: ['accepted', 'rejected'],
      type: 'input',
    });
    this.monitors.push(monitor);
  }

  start() {
    const stream = super.create()(() => {});

    this.inputs.map((input) => {
      const monitor = this.monitors.find(
        (monitor) => monitor.type === 'input' && monitor.name === input.name
      );
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
          console.log(input.name + ': ' + msg);
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
    this.nodes[name] = node;
  }

  getNode(name) {
    return this.nodes[name];
  }
}

module.exports = new Pipeline();
