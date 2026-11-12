const dns = require('dns').promises;
const net = require('net');

const debug = require('debug')('hyperwatch:hostname');

const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

if (process.env.HYPERWATCH_DNS_SERVER) {
  dns.setServers([process.env.HYPERWATCH_DNS_SERVER]);
}

function ignoreError() {
  return null;
}

// Compare addresses in canonical form: DNS and logs may write the same IPv6
// address differently (zero compression, case)
function canonical(ip) {
  return net.isIPv6(ip) ? new URL(`http://[${ip}]`).hostname : ip;
}

function isValid(hostname) {
  return (
    hostname &&
    !hostname.endsWith('.ip6.arpa') &&
    !hostname.endsWith('.in-addr.arpa')
  );
}

/**
 * @typedef {{ value: string | null, verified?: boolean }} HostnameEntry
 */

/**
 * The hostname of an address, cached
 * @param {string} ip
 * @param {{ fast?: boolean }} [options] `fast`: only from the cache
 * @returns {Promise<HostnameEntry>}
 */
async function lookup(ip, { fast = false } = {}) {
  if (await cache.has(ip)) {
    return /** @type {HostnameEntry} */ (await cache.get(ip));
  }

  /** @type {HostnameEntry} */
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
      const reverseIps = await (
        net.isIPv6(ip) ? dns.resolve6(reverse) : dns.resolve4(reverse)
      ).catch(ignoreError);
      if (reverseIps) {
        debug(`Resolve ${reverse}: ${reverseIps.join(', ')}`);
        if (reverseIps.map(canonical).includes(canonical(ip))) {
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

/**
 * @param {import('../types').Log} log
 * @param {{ fast?: boolean }} [options]
 */
async function augment(log, { fast = false } = {}) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = await lookup(/** @type {string} */ (ip), { fast });

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
