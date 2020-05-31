const { fromJS } = require('immutable');
const lruCache = require('lru-cache');
const useragent = require('useragent');

const cache = new lruCache({ max: 1000 });

function lookup(ua) {
  if (cache.has(ua)) {
    return cache.get(ua);
  }

  let result = useragent.parse(ua);

  result = result.toJSON();
  if (result.os.toJSON) {
    result.os = result.os.toJSON();
  }
  if (result.device.toJSON) {
    result.device = result.device.toJSON();
  }

  console.log(ua, result);

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

module.exports = {
  lookup,
  augment,
};
