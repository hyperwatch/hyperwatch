const { default: chalk } = require('chalk');

const { escapeHtml, safeHtml, SafeHtml } = require('./util');

/**
 * A value in a color: with chalk on the console, in a span in HTML
 * @template T
 * @param {string} name A chalk color (`grey`, `magenta`…), also the class
 * @param {T} value
 * @param {string} [output]
 * @returns {string | T}
 */
const colorize = (name, value, output) => {
  if (output === 'console') {
    return chalk[/** @type {import('chalk').ForegroundColorName} */ (name)](
      value
    );
  } else if (output === 'html') {
    return `<span class="${name}">${value}</span>`;
  }
  return value;
};

/** @type {Format} */
const time = (log) =>
  /** @type {string} */ (log.getIn(['request', 'time'])).slice(11, -5);

// Hostnames confirmed by a forward lookup end with '+'. In HTML, the
// stylesheet adds a ✓ instead, which isn't copied with the hostname.
/** @type {Format} */
const address = (log, output) => {
  if (log.hasIn(['address', 'hostname'])) {
    const hostname = log.getIn(['address', 'hostname']);
    const verified = log.getIn(['hostname', 'verified']);
    if (output === 'html' && verified) {
      return safeHtml(
        `<span class="verified" title="Verified: the hostname resolves back to this address">${escapeHtml(hostname)}</span>`
      );
    }
    if (output === 'html') {
      return hostname;
    }
    return `${hostname}${verified ? '+' : ''}`;
  } else {
    return log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
  }
};

/** @type {Format} */
const request = (log) => {
  const method = log.getIn(['request', 'method']);
  const url = /** @type {string} */ (log.getIn(['request', 'url'])).split(
    '?'
  )[0];
  const status = log.getIn(['response', 'status']);
  return `"${method} ${url} ${status}"`;
};

// Milliseconds, with thousands separators (1,016ms) except in plain text
/** @type {Format} */
const executionTime = (log, output) => {
  const ms = log.get('executionTime');
  if (!ms) {
    return;
  }
  const text = `${
    output === 'html' || output === 'console'
      ? Number(ms).toLocaleString('en-US')
      : ms
  }ms`;
  const color = ms <= 100 ? 'green' : ms >= 1000 ? 'red' : 'yellow';
  const colored = colorize(color, text, output);
  return output === 'html' ? safeHtml(colored) : colored;
};

// A format's value for the output: in HTML, text is escaped and safeHtml()
// kept as is
/**
 * @param {unknown} value
 * @param {string} [output]
 * @returns {unknown}
 */
const forOutput = (value, output) => {
  if (value instanceof SafeHtml) {
    return value.html;
  }
  return output === 'html' && typeof value === 'string'
    ? escapeHtml(value)
    : value;
};

/** @type {Format} */
const identity = (log) => log.getIn(['identity'], '');

/** @type {Format} */
const agent = (log) => {
  return log.getIn(['request', 'headers', 'user-agent'], '');
};

/**
 * A field of a formatted log: its value, for an output (`console`, `html`,
 * `text`)
 * @typedef {(log: Log, output?: string) => any} Format
 */

/** @typedef {import('../types').Log} Log */

class Formatter {
  constructor() {
    /** @type {Array<[string, Format]>} */
    this.formats = [
      ['time', time],
      ['identity', identity],
      ['address', address],
      ['request', request],
      ['executionTime', executionTime],
      ['agent', agent],
    ];

    /** @type {Record<string, string>} Chalk color (or class) by key */
    this.colors = {
      time: 'grey',
      identity: 'magenta',
      address: 'cyan',
      country: 'grey',
      agent: 'grey',
      os: 'grey',
    };
  }

  /** @returns {Formatter} */
  clone() {
    const formatter = new Formatter();
    formatter.formats = [...this.formats];
    formatter.colors = { ...this.colors };
    formatter.output = this.output;

    return formatter;
  }

  /**
   * The output when formatObject() and format() get none
   * @param {string} output `console`, `html` or `text`
   * @returns {this}
   */
  setOutput(output) {
    this.output = output;

    return this;
  }

  /**
   * @param {Array<[string, Format]>} formats
   * @returns {this}
   */
  setFormats(formats) {
    this.formats = formats;

    return this;
  }

  /**
   * Keeps only the fields of `keys`
   * @param {string[]} [keys]
   * @returns {this}
   */
  pickFormats(keys = []) {
    this.formats = this.formats.filter(([key]) => keys.includes(key));

    return this;
  }

  /**
   * @param {string} key
   * @param {Format} fn
   * @returns {this}
   */
  replaceFormat(key, fn) {
    const index = this.formats.findIndex(([k]) => k == key);
    if (index !== -1) {
      this.formats[index] = [key, fn];
    }

    return this;
  }

  /**
   * Adds a field to the formatted logs
   * @param {string} key
   * @param {Format} fn
   * @param {{ after?: string, before?: string, color?: string }} [options]
   *   Where (after or before another key), and its color
   * @returns {this}
   */
  insertFormat(key, fn, { after, before, color } = {}) {
    if (color) {
      this.colors[key] = color;
    }

    if (after || before) {
      const index = this.formats.findIndex(([k]) => k == (after || before));
      if (index !== -1) {
        this.formats.splice(after ? index + 1 : index, 0, [key, fn]);

        return this;
      }
    }

    this.formats.push([key, fn]);

    return this;
  }

  /**
   * The fields of a log (or an aggregator entry), by key
   * @param {Log} log
   * @param {string} [output] `console`, `html` or `text`
   * @returns {Record<string, any>}
   */
  formatObject(log, output) {
    output = output || this.output || 'html';

    const result = Object.fromEntries(
      this.formats.map(([key, fn]) => [key, forOutput(fn(log, output), output)])
    );

    if (output === 'console' || output === 'html') {
      for (const [key, name] of Object.entries(this.colors)) {
        if (result[key]) {
          result[key] = colorize(name, result[key], output);
        }
      }
    }

    return result;
  }

  /**
   * The fields of a log on one line
   * @param {Log} log
   * @param {string} [output]
   * @returns {string}
   */
  format(log, output) {
    const result = this.formatObject(log, output);

    return Object.values(result)
      .filter((str) => str && str.length > 0)
      .join(' ');
  }
}

module.exports.Formatter = Formatter;
module.exports.colorize = colorize;
module.exports.time = time;
module.exports.address = address;
module.exports.request = request;
module.exports.identity = identity;
module.exports.executionTime = executionTime;
