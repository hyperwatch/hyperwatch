const chalk = require('chalk');
const countryCodeEmoji = require('country-code-emoji');

const time = (log) => log.getIn(['request', 'time']).slice(11, -5);

const address = (log) => {
  if (log.hasIn(['address', 'hostname'])) {
    const verified = log.getIn(['hostname', 'verified']);
    return `${log.getIn(['address', 'hostname'])}${verified ? '+' : ''}`;
  } else {
    return log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
  }
};

const country = (log, output) => {
  const cc = log.getIn(['geoip', 'country']);
  if (cc) {
    return output === 'console' ? cc : `${countryCodeEmoji(cc)} ${cc}`;
  }
};

const city = (log) => {
  return log.getIn(['geoip', 'country']);
};

const request = (log) => {
  const method = log.getIn(['request', 'method']);
  const url = log.getIn(['request', 'url']).split('?')[0];
  const status = log.getIn(['response', 'status']);
  return `"${method} ${url} ${status}"`;
};

const executionTime = (log, output) => {
  if (output === 'console') {
    return log.get('executionTime') <= 100
      ? chalk.green(`${log.get('executionTime')}ms`)
      : log.get('executionTime') >= 1000
      ? chalk.red(`${log.get('executionTime')}ms`)
      : chalk.yellow(`${log.get('executionTime')}ms`);
  } else {
    return log.get('executionTime') <= 100
      ? `<span class="green">${log.get('executionTime')}ms</span>`
      : log.get('executionTime') >= 1000
      ? `<span class="orange">${log.get('executionTime')}ms</span>`
      : `<span class="yellow">${log.get('executionTime')}ms</span>`;
  }
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

const colorize = (object, output = 'console') => {
  for (const [key, value] of Object.entries(object)) {
    if (!value) {
      continue;
    }
    switch (key) {
      case 'time':
        object[key] =
          output === 'console'
            ? chalk.grey(value)
            : `<span class="grey">${value}</span>`;
        break;
      case 'address':
        object[key] =
          output === 'console'
            ? chalk.cyan(value)
            : `<span class="blue">${value}</span>`;

        break;
      case 'agent':
      case 'os':
      case 'cc':
      case 'country':
      case 'city':
        object[key] =
          output === 'console'
            ? chalk.grey(value)
            : `<span class="grey">${value}</span>`;
        break;
      case 'identity':
        object[key] =
          output === 'console'
            ? chalk.magenta(value)
            : `<span class="purple">${value}</span>`;
        break;
    }
  }

  return object;
};

const defaultLogFormatter = (log, output) => ({
  time: time(log),
  identity: identity(log),
  address: address(log),
  cc: country(log, output),
  request: request(log),
  executionTime: executionTime(log, output),
  agent: agent(log),
});

class Formatter {
  constructor(output, logFormatter) {
    this.output = output || 'html';
    this.logFormatter = logFormatter || defaultLogFormatter;
  }

  setLogFormatter(fn) {
    this.logFormatter = fn;
  }

  format(log) {
    return Object.values(
      colorize(this.logFormatter(log, this.output), this.output)
    )
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
  country,
  city,
  agent,
  os,
  identity,
  executionTime,
};
