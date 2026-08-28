const dnsbl = require('dnsbl');

const aggregator = require('../lib/aggregator');
const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

// Indirection so tests can swap the DNS lookup without hitting the network.
const defaultLookup = (ip, blacklist) => dnsbl.lookup(ip, blacklist);
let lookup = defaultLookup;

function setLookup(fn = defaultLookup) {
  lookup = fn;
}

async function xblLookup(ip) {
  if (await cache.has(`xbl-${ip}`)) {
    return cache.get(`xbl-${ip}`);
  }
  const result = await lookup(ip, 'xbl.spamhaus.org');
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

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('xbl', xblFormat, {
    after: 'address',
    color: 'grey',
  });
}

module.exports = {
  augment,
  init,
  setLookup,
  xblFormat,
};
