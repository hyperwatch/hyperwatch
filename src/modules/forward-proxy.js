/**
 * Forward proxies: the proxies of the clients (corporate web gateways), as
 * opposed to the site's own reverse proxies (CDNs, see plugins/proxy.js).
 * Many organizations share their egress addresses, and they put the address
 * they forward for in X-Forwarded-For. When the client address is a verified
 * egress of one, the log gets `address.proxy` (its name) and
 * `address.forwarded`. `address.value` stays the connecting address: what a
 * forward proxy writes is a hint.
 */
// Run `node scripts/fetch-ips.js zscaler-ips` to update
const zscalerIps = require('../data/zscaler-ips.json');
const { compileRanges, isValidAddress } = require('../lib/cidr');
const pipeline = require('../lib/pipeline');

// The published egress ranges of each forward proxy
const proxies = [{ name: 'Zscaler', match: compileRanges(zscalerIps) }];

/**
 * The address a forward proxy forwards for: in X-Forwarded-For, the one just
 * before the proxy's own (a CDN in front of the site appends it), or the last
 * one (the proxy connected directly). Earlier entries were written by
 * whoever sent the request to the proxy: they can't be trusted.
 * @param {unknown} header
 * @param {string} egress
 */
function forwardedFor(header, egress) {
  if (typeof header !== 'string') {
    return;
  }
  const hops = header.split(',').map((hop) => hop.trim());
  const index = hops.lastIndexOf(egress);
  const hop = index === -1 ? hops[hops.length - 1] : hops[index - 1];
  return hop && hop !== egress && isValidAddress(hop) ? hop : undefined;
}

/**
 * The client address: `address.value`, set by the cloudflare or address
 * module, else the request's
 * @param {Log} log
 * @returns {unknown}
 */
function clientAddress(log) {
  return log.hasIn(['address', 'value'])
    ? log.getIn(['address', 'value'])
    : log.getIn(['request', 'address']);
}

/** @param {Log} log */
function augment(log) {
  const egress = clientAddress(log);
  // The first module to set the proxy wins
  if (typeof egress !== 'string' || log.hasIn(['address', 'proxy'])) {
    return log;
  }
  const proxy = proxies.find(({ match }) => match(egress));
  if (!proxy) {
    return log;
  }
  log = log.setIn(['address', 'proxy'], proxy.name);
  const forwarded = forwardedFor(
    log.getIn(['request', 'headers', 'x-forwarded-for']),
    egress
  );
  return forwarded ? log.setIn(['address', 'forwarded'], forwarded) : log;
}

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

module.exports = {
  init,
  augment,
  forwardedFor,
};

/** @typedef {import('../types').Log} Log */
