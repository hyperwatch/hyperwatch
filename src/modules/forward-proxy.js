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
const { compileRanges, parseAddress } = require('../lib/cidr');
const pipeline = require('../lib/pipeline');

// The published egress ranges of each forward proxy. Only proxies that
// replace X-Forwarded-For with a single entry (see forwardedFor)
const proxies = [{ name: 'Zscaler', match: compileRanges(zscalerIps) }];

// An address in one form, to compare them: undefined when invalid
/** @param {unknown} value */
function canonical(value) {
  const address = parseAddress(value);
  return address ? address.correctForm() : undefined;
}

/**
 * The address a forward proxy forwards for, in X-Forwarded-For. The proxies
 * listed replace the header they receive with a single entry (Zscaler: "it
 * removes the original XFF header and replaces it with an XFF header that
 * contains the IP address of the client gateway"), so nothing before that
 * entry comes from their client:
 * - a reverse proxy of the site (a CDN) appended the egress, and maybe
 *   others their own: the entry just before the last occurrence of the egress;
 * - the proxy connected directly: the header is its single entry.
 * Otherwise, nothing. The entry is returned in canonical form, unless it is
 * the egress itself.
 * @param {unknown} header
 * @param {string} egress
 */
function forwardedFor(header, egress) {
  if (typeof header !== 'string') {
    return;
  }
  const self = canonical(egress);
  const hops = header.split(',').map((hop) => canonical(hop.trim()));
  const index = hops.lastIndexOf(self);
  const hop =
    index === -1 ? (hops.length === 1 ? hops[0] : undefined) : hops[index - 1];
  return hop && hop !== self ? hop : undefined;
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
