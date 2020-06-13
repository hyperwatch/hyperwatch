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
  const userAgent = log.getIn(['request', 'headers', 'user-agent'], '');
  const agent = log.get('useragent');
  if (agent && agent.get('family') && agent.get('family') !== 'Other') {
    const { family, major, minor, patch, patch_minor } = agent.toJS();
    const name = family
      .replace('Mobile', '')
      .replace(' iOS', '')
      .replace('  ', ' ')
      .trim();
    if (patch_minor) {
      return `${name}/${major}.${minor}.${patch}.${patch_minor}`;
    } else if (patch) {
      return `${name}/${major}.${minor}.${patch}`;
    } else if (minor) {
      return `${name}/${major}.${minor}`;
    } else if (major) {
      return `${name}/${major}`;
    } else {
      return `${name}`;
    }
  } else {
    return userAgent;
  }
};

const os = (log) => {
  const agentOs = log.getIn(['useragent', 'os']);
  if (!agentOs) {
    return;
  }
  if (agentOs.get('family') === 'Other' || !agentOs.get('family')) {
    return;
  }
  if (agentOs.get('family') === 'Mac OS X') {
    return 'macOS';
  }
  return agentOs.get('family');
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

  insertFormat(key, fn, { after } = {}) {
    if (after) {
      const index = this.formats.findIndex(([k]) => k == after);
      if (index) {
        this.formats.splice(index + 1, 0, [key, fn]);

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

    console.log(result);

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
  agent,
  os,
  identity,
  executionTime,
};
