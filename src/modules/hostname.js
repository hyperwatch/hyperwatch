const dns = require('dns').promises;

const debug = require('debug')('hyperwatch:hostname');

const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

if (process.env.HYPERWATCH_DNS_SERVER) {
  dns.setServers([process.env.HYPERWATCH_DNS_SERVER]);
}

function ignoreError() {
  return null;
}

function isValid(hostname) {
  return (
    hostname &&
    !hostname.endsWith('.ip6.arpa') &&
    !hostname.endsWith('.in-addr.arpa')
  );
}

async function lookup(ip, { fast = false } = {}) {
  if (await cache.has(ip)) {
    return cache.get(ip);
  }

  const entry = { value: null };

  if (fast) {
    return entry;
  }

  debug(`Reverse ${ip} ...`);
  const reverses = await dns.reverse(ip).catch(ignoreError);
  if (reverses) {
    const reverse = reverses[0];
    debug(`Reverse ${ip}: ${reverse}`);
    if (isValid(reverse)) {
      entry.value = reverse;
      debug(`Resolve ${reverse} ...`);
      const reverseIps = await dns.resolve(reverse).catch(ignoreError);
      if (reverseIps) {
        const reverseIp = reverseIps[0];
        debug(`Resolve ${reverse}: ${reverseIp}`);
        if (reverseIp === ip) {
          entry.verified = true;
        }
      } else {
        debug(`Resolve ${reverse}: no result`);
      }
    }
  } else {
    debug(`Reverse ${ip}: no result`);
  }

  cache.set(ip, entry);

  return entry;
}

async function augment(log, { fast = false } = {}) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = await lookup(ip, { fast });

  if (entry.value) {
    log = log.setIn(['hostname', 'value'], entry.value);
    log = log.setIn(['address', 'hostname'], entry.value);
  }

  if (entry.verified !== undefined) {
    log = log.setIn(['hostname', 'verified'], entry.verified);
  }

  return log;
}

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

module.exports = {
  lookup,
  augment,
  init,
};
