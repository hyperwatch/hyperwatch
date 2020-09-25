const fs = require('fs');
const path = require('path');

const { fromJS } = require('immutable');
const lruCache = require('lru-cache');

const aggregator = require('../lib/aggregator');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');
const useragent = require('../lib/useragent');

const cache = new lruCache({ max: 1000 });

const uas = {};

const alphabeticalSort = (a, b) =>
  a.toLowerCase().localeCompare(b.toLowerCase());

const prettyJsonStringify = (value) => JSON.stringify(value, null, 2);

function store(ua) {
  const date = new Date().toISOString().slice(0, 10);
  const filename = path.join(__dirname, '../../data/ua', `${date}.json`);
  if (uas[date] === undefined) {
    try {
      uas[date] = require(filename);
    } catch (err) {
      uas[date] = [];
    }
  }

  if (!uas[date].includes(ua)) {
    uas[date].push(ua);
    fs.writeFileSync(
      filename,
      prettyJsonStringify(uas[date].sort(alphabeticalSort))
    );
  }
}

function lookup(ua) {
  if (cache.has(ua)) {
    return cache.get(ua);
  }

  if (process.env.HYPERWATCH_AGENT_STORE) {
    store(ua);
  }

  let result = useragent.parse(ua);

  result = result.toJSON();

  cache.set(ua, result);

  return result;
}

function augment(log) {
  const userAgentString = log.getIn(['request', 'headers', 'user-agent']);

  if (userAgentString) {
    const agent = lookup(userAgentString);
    if (agent) {
      log = log.set('agent', fromJS(agent));
    }
  }

  return log;
}

const agentFormat = (log, output) => {
  const agent = log.get('agent');
  if (agent && agent.get('family') && agent.get('family') !== 'Other') {
    const { family, major, minor } = agent.toJS();
    if (minor) {
      return `${family}/${major}.${minor}`;
    } else if (major) {
      return `${family}/${major}`;
    } else {
      return `${family}`;
    }
  } else {
    return log.getIn(
      ['request', 'headers', 'user-agent'],
      output === 'html' ? '<em>Empty</em>' : 'Empty'
    );
  }
};

const osFormat = (log) => {
  const agentOs = log.getIn(['agent', 'os']);
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

function load() {
  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('agent', agentFormat, {
    before: '15m',
    color: 'grey',
  });
  aggregator.defaultFormatter.insertFormat('os', osFormat, {
    after: 'agent',
    color: 'grey',
  });

  logger.defaultFormatter.replaceFormat('agent', agentFormat);
}

module.exports = {
  lookup,
  augment,
  load,
  agentFormat,
  osFormat,
};
