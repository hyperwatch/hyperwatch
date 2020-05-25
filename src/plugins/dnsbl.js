const dnsbl = require('dnsbl');
const lruCache = require('lru-cache');

const cache = new lruCache({ max: 1000 });

const xbl = async (ip) => {
  if (cache.has(`xbl-${ip}`)) {
    return cache.get(`xbl-${ip}`);
  }
  const result = await dnsbl.lookup(ip, 'xbl.spamhaus.org');
  cache.set(`xbl-${ip}`, result);
  return result;
};

async function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const xblResult = await xbl(ip);
  if (xblResult !== undefined) {
    log = log.setIn(['dnsbl', 'xbl'], xblResult);
  }

  return log;
}

module.exports = {
  augment,
};
