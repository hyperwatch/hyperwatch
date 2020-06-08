const chalk = require('chalk');

const colorize = (name, value, output) => {
  if (output === 'console') {
    return chalk[name](value);
  } else if (output === 'html') {
    return `<span class="${name}">${value}</span>`;
  }
  return value;
};

const time = (log) => log.getIn(['request', 'time']).slice(11, -5);

const address = (log) => {
  if (log.hasIn(['address', 'hostname'])) {
    const verified = log.getIn(['hostname', 'verified']);
    return `${log.getIn(['address', 'hostname'])}${verified ? '+' : ''}`;
  } else {
    return log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
  }
};

const language = (log) => {
  const code = log.getIn(['language', 0, 'code']);
  if (code) {
    const region = log.getIn(['language', 0, 'region']);
    if (region) {
      return `${code.toLowerCase()} ${region.toUpperCase()}`;
    } else {
      return code.toLowerCase();
    }
  }
};

const request = (log) => {
  const method = log.getIn(['request', 'method']);
  const url = log.getIn(['request', 'url']).split('?')[0];
  const status = log.getIn(['response', 'status']);
  return `"${method} ${url} ${status}"`;
};

const executionTime = (log, output) => {
  return log.get('executionTime') <= 100
    ? colorize('green', `${log.get('executionTime')}ms`, output)
    : log.get('executionTime') >= 1000
    ? colorize('red', `${log.get('executionTime')}ms`, output)
    : colorize('yellow', `${log.get('executionTime')}ms`, output);
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
    if (index) {
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
      if (index) {
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
  language,
  executionTime,
};
