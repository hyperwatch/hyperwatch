const dns = require('dns').promises;

const lruCache = require('lru-cache');

const hostnameMeta = require('../data/hostname-meta.json');

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

async function meta(log) {
  if (!log.getIn(['hostname', 'value'])) {
    return log;
  }

  const hostname = log.getIn(['hostname', 'value']);

  for (const ext of Object.keys(hostnameMeta)) {
    if (hostname.endsWith(ext)) {
      for (const domain of Object.keys(hostnameMeta[ext])) {
        if (hostname.endsWith(domain)) {
          for (const props of hostnameMeta[ext][domain]) {
            for (const [key, value] of Object.entries(props)) {
              log = log.setIn(['address', key], value);
            }
          }
          break;
        }
      }
      break;
    }
  }

  return log;
}

module.exports = {
  lookup,
  augment,
  meta,
};
