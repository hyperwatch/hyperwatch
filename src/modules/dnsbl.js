const dnsbl = require('dnsbl');

const aggregator = require('../lib/aggregator');
const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

async function xblLookup(ip) {
  if (await cache.has(`xbl-${ip}`)) {
    return cache.get(`xbl-${ip}`);
  }
  const result = await dnsbl.lookup(ip, 'xbl.spamhaus.org');
  cache.set(`xbl-${ip}`, result);
  return result;
}

async function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const xblResult = await xblLookup(ip);
  if (xblResult !== undefined) {
    log = log.setIn(['dnsbl', 'xbl'], xblResult);
  }

  return log;
}

const xblFormat = (log, output) => {
  if (output === 'json') {
    return log.getIn(['dnsbl', 'xbl']) ? true : false;
  } else {
    return log.getIn(['dnsbl', 'xbl']) ? 'x' : '';
  }
};

function load() {
  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('xbl', xblFormat, {
    after: 'address',
    color: 'grey',
  });
}

module.exports = {
  augment,
  load,
};
