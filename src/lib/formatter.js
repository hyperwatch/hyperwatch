const { default: chalk } = require('chalk');

const { escapeHtml } = require('./util');

const colorize = (name, value, output) => {
  if (output === 'console') {
    return chalk[name](value);
  } else if (output === 'html') {
    return `<span class="${name}">${value}</span>`;
  }
  return value;
};

const time = (log) => log.getIn(['request', 'time']).slice(11, -5);

// Hostnames confirmed by a forward lookup end with '+'. In HTML, the
// stylesheet adds a ✓ instead, which isn't copied with the hostname.
const address = (log, output) => {
  if (log.hasIn(['address', 'hostname'])) {
    const hostname = log.getIn(['address', 'hostname']);
    const verified = log.getIn(['hostname', 'verified']);
    if (output === 'html') {
      return verified
        ? `<span class="verified" title="Verified: the hostname resolves back to this address">${escapeHtml(hostname)}</span>`
        : escapeHtml(hostname);
    }
    return `${hostname}${verified ? '+' : ''}`;
  } else {
    return log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
  }
};

const request = (log) => {
  const method = log.getIn(['request', 'method']);
  const url = log.getIn(['request', 'url']).split('?')[0];
  const status = log.getIn(['response', 'status']);
  return `"${method} ${url} ${status}"`;
};

// Milliseconds, with thousands separators (1,016ms) except in plain text
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
  return colorize(color, text, output);
};

const identity = (log) => log.getIn(['identity'], '');

const agent = (log) => {
  return log.getIn(['request', 'headers', 'user-agent'], '');
};

class Formatter {
  constructor() {
    this.formats = [
      ['time', time],
      ['identity', identity],
      ['address', address],
      ['request', request],
      ['executionTime', executionTime],
      ['agent', agent],
    ];

    this.colors = {
      time: 'grey',
      identity: 'magenta',
      address: 'cyan',
      country: 'grey',
      agent: 'grey',
      os: 'grey',
    };
  }

  clone() {
    const formatter = new Formatter();
    formatter.formats = [...this.formats];
    formatter.colors = { ...this.colors };
    formatter.output = this.output;

    return formatter;
  }

  setOutput(output) {
    this.output = output;

    return this;
  }

  setFormats(formats) {
    this.formats = formats;

    return this;
  }

  pickFormats(keys = []) {
    this.formats = this.formats.filter(([key]) => keys.includes(key));

    return this;
  }

  replaceFormat(key, fn) {
    const index = this.formats.findIndex(([k]) => k == key);
    if (index !== -1) {
      this.formats[index] = [key, fn];
    }

    return this;
  }

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

  formatObject(log, output) {
    output = output || this.output || 'html';

    const result = Object.fromEntries(
      this.formats.map(([key, fn]) => [key, fn(log, output)])
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

  format(log, output) {
    const result = this.formatObject(log, output);

    return Object.values(result)
      .filter((str) => str && str.length > 0)
      .join(' ');
  }
}

module.exports = {
  Formatter,
  colorize,
  time,
  address,
  request,
  identity,
  executionTime,
};
