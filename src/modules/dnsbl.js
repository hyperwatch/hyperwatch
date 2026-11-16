const dnsbl = require('dnsbl');

const aggregator = require('../lib/aggregator');
const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

// Indirection so tests can swap the DNS lookup without hitting the network.
/**
 * Whether an address is in a DNS blacklist
 * @typedef {(ip: string, blacklist: string) => Promise<boolean>} Lookup
 */

/** @type {Lookup} */
const defaultLookup = (ip, blacklist) => dnsbl.lookup(ip, blacklist);
let lookup = defaultLookup;

/** @param {Lookup} [fn] The DNS lookup by default */
function setLookup(fn = defaultLookup) {
  lookup = fn;
}

/**
 * Whether an address is in Spamhaus XBL, cached
 * @param {string} ip
 * @returns {Promise<boolean>}
 */
async function xblLookup(ip) {
  if (await cache.has(`xbl-${ip}`)) {
    return cache.get(`xbl-${ip}`);
  }
  const result = await lookup(ip, 'xbl.spamhaus.org');
  cache.set(`xbl-${ip}`, result);
  return result;
}

/** @param {Log} log */
async function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const xblResult = await xblLookup(/** @type {string} */ (ip));
  if (xblResult !== undefined) {
    log = log.setIn(['dnsbl', 'xbl'], xblResult);
  }

  return log;
}

/** @type {Format} */
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

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/formatter').Format} Format */
