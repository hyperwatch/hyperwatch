const { fromJS } = require('immutable');
const lruCache = require('lru-cache');

const useragent = require('../lib/useragent');

const cache = new lruCache({ max: 1000 });

function lookup(ua) {
  if (cache.has(ua)) {
    return cache.get(ua);
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
      log = log.set('useragent', fromJS(agent));
    }
  }

  return log;
}

module.exports = {
  lookup,
  augment,
};
