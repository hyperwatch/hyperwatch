const dns = require('dns').promises;

const lruCache = require('lru-cache');

const pipeline = require('../lib/pipeline');

const cache = new lruCache({ max: 1000 });

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

async function lookup(ip) {
  if (cache.has(ip)) {
    return cache.get(ip);
  }

  const entry = { hostname: null };

  const reverses = await dns.reverse(ip).catch(ignoreError);
  if (reverses) {
    const reverse = reverses[0];
    if (isValid(reverse)) {
      entry.value = reverse;
      const reverseIps = await dns.resolve(reverse).catch(ignoreError);
      if (reverseIps) {
        const reverseIp = reverseIps[0];
        if (reverseIp === ip) {
          entry.verified = true;
        }
      }
    }
  }

  cache.set(ip, entry);

  return entry;
}

async function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = await lookup(ip);

  if (entry.value) {
    log = log.setIn(['hostname', 'value'], entry.value);
    log = log.setIn(['address', 'hostname'], entry.value);
  }

  if (entry.verified !== undefined) {
    log = log.setIn(['hostname', 'verified'], entry.verified);
  }

  return log;
}

function registerPipeline() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function register() {
  registerPipeline();
}

module.exports = {
  lookup,
  augment,
  register,
  registerPipeline,
};
