const { fromJS } = require('immutable');
const lruCache = require('lru-cache');

const aggregator = require('../lib/aggregator');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');
const useragent = require('../lib/useragent');

const cache = new lruCache({ max: 1000 });

function lookup(ua) {
  if (cache.has(ua)) {
    return cache.get(ua);
  }

  let result = useragent.parse(ua);

  result = result.toJSON();

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

const agent = (log) => {
  const agent = log.get('agent');
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
    return log.getIn(['request', 'headers', 'user-agent'], '');
  }
};

const os = (log) => {
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

function registerFormatters() {
  aggregator.defaultFormatter.insertFormat('agent', agent, {
    before: '15m',
    color: 'grey',
  });
  aggregator.defaultFormatter.insertFormat('os', os, {
    after: 'agent',
    color: 'grey',
  });
  logger.defaultFormatter.replaceFormat('agent', agent);
}

function registerPipeline() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function register() {
  registerPipeline();
  registerFormatters();
}

module.exports = {
  lookup,
  augment,
  register,
  registerFormatters,
};
