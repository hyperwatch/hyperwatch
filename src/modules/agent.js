// @ts-expect-error -- @hyperwatch/useragent ships no types: any
const useragent = require('@hyperwatch/useragent');
const { fromJS } = require('immutable');

const aggregator = require('../lib/aggregator');
const cache = require('../lib/cache');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');
const { safeHtml } = require('../lib/util');

/**
 * A user agent parsed by @hyperwatch/useragent, as `agent` in logs (declared
 * here: the package has no types)
 * @typedef {object} Agent
 * @property {string | null} family `Other` when unknown
 * @property {string | null} major
 * @property {string | null} minor
 * @property {string | null} patch
 * @property {string | null} patch_minor
 * @property {string} [type]
 * @property {{ family: string | null, major: string | null, minor: string | null, patch: string | null, patch_minor: string | null }} [os]
 * @property {{ family: string | null, brand: string | null, model: string | null }} [device]
 */

/**
 * The parsed user agent, cached
 * @param {string} ua A User-Agent header
 * @returns {Promise<Agent>}
 */
async function lookup(ua) {
  if (await cache.has(ua)) {
    return cache.get(ua);
  }

  const result = useragent.parse(ua).toJSON();

  cache.set(ua, result);

  return result;
}

/** @param {Log} log */
async function augment(log) {
  const userAgentString = /** @type {string | undefined} */ (
    log.getIn(['request', 'headers', 'user-agent'])
  );

  if (userAgentString) {
    const agent = await lookup(userAgentString);
    if (agent) {
      log = log.set('agent', fromJS(agent));
    }
  }

  return log;
}

/** @type {Format} */
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
      output === 'html' ? safeHtml('<em>Empty</em>') : 'Empty'
    );
  }
};

/** @type {Format} */
const osFormat = (log) => {
  const agentOs =
    /** @type {import('immutable').Map<string, any> | undefined} */ (
      log.getIn(['agent', 'os'])
    );
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

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('agent', agentFormat, {
    before: 'count15m',
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
  init,
  agentFormat,
  osFormat,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/formatter').Format} Format */
