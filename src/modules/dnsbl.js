const { Resolver } = require('dns').promises;
const net = require('net');

const aggregator = require('../lib/aggregator');
const cache = require('../lib/cache');
const pipeline = require('../lib/pipeline');

const XBL = 'xbl.spamhaus.org';

// Spamhaus refuses queries arriving through public resolvers, so query
// OpenDNS directly (same default as the `dnsbl` package).
const SERVERS = ['208.67.220.220', '208.67.222.222'];
const TIMEOUT = 5000;

// Reverse the address for a DNSBL query: 1.2.3.4 -> 4.3.2.1, IPv6 by nibbles
function reverse(ip) {
  if (net.isIPv4(ip)) {
    return ip.split('.').reverse().join('.');
  }
  if (net.isIPv6(ip)) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) {
      return reverse(mapped[1]);
    }
    const [head, tail] = ip.split('::');
    const groups = (part) => (part ? part.split(':') : []);
    const missing = 8 - groups(head).length - groups(tail).length;
    const full =
      tail === undefined
        ? groups(head)
        : [...groups(head), ...Array(missing).fill('0'), ...groups(tail)];
    return full
      .map((group) => group.padStart(4, '0'))
      .join('')
      .split('')
      .reverse()
      .join('.');
  }
}

// Resolves the A records of the query, [] when the address isn't listed.
async function defaultLookup(ip, blacklist) {
  const resolver = new Resolver({ timeout: TIMEOUT, tries: 1 });
  resolver.setServers(SERVERS);
  try {
    return await resolver.resolve4(`${reverse(ip)}.${blacklist}`);
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return [];
    }
    throw err;
  }
}

// Indirection so tests can swap the DNS lookup without hitting the network.
let lookup = defaultLookup;

function setLookup(fn = defaultLookup) {
  lookup = fn;
}

// 127.255.255.x are Spamhaus error codes (public resolver, rate limited,
// typo...): they say nothing about the address. Warn once per code.
const warned = new Set();

function warnOnce(key, message) {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`dnsbl: ${message}`);
  }
}

// true: listed, false: not listed, null: unknown (lookup refused or failed)
async function query(ip, blacklist) {
  let answers;
  try {
    answers = await lookup(ip, blacklist);
  } catch (err) {
    warnOnce(
      err.code || err.message,
      `${blacklist} lookup failed (${err.code || err.message})`
    );
    return null;
  }
  if (answers.length === 0) {
    return false;
  }
  if (answers.some((answer) => answer.startsWith('127.0.0.'))) {
    return true;
  }
  warnOnce(
    answers.join(','),
    `${blacklist} refused the query (${answers.join(', ')}), XBL disabled for these lookups`
  );
  return null;
}

async function xblLookup(ip) {
  if (!net.isIP(ip)) {
    return null;
  }
  if (await cache.has(`xbl-${ip}`)) {
    return cache.get(`xbl-${ip}`);
  }
  const result = await query(ip, XBL);
  cache.set(`xbl-${ip}`, result);
  return result;
}

async function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const xblResult = await xblLookup(ip);
  if (typeof xblResult === 'boolean') {
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
  reverse,
  setLookup,
  xblFormat,
};
