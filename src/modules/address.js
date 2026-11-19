const { is } = require('immutable');

const api = require('../app/api');
const html = require('../app/html');
// Run `node scripts/fetch-ips.js zscaler-ips` to update
const zscalerIps = require('../data/zscaler-ips.json');
const { Aggregator } = require('../lib/aggregator');
const { compileRanges, isValidAddress } = require('../lib/cidr');
const pipeline = require('../lib/pipeline');
const { touch, prune, countRecent } = require('../lib/recent-map');
const { safeHtml, toHtml } = require('../lib/util');

// Corporate web gateways: the published egress ranges of shared proxies that
// put their user's address in X-Forwarded-For
const gateways = [{ name: 'Zscaler', match: compileRanges(zscalerIps) }];

/** @type {Identifier} */
const identifier = (log) => log.getIn(['address', 'value']);

/** @type {Sorter} */
const signatureCount15m = (entry) =>
  countRecent(entry.get('signatures'), 15 * 60);
/** @type {Sorter} */
const signatureCount24h = (entry) => countRecent(entry.get('signatures'));

/** @type {Aggregator | undefined} */
let aggregator;

/** @type {Sorter} */
const forwardedCount24h = (entry) => countRecent(entry.get('forwarded'));

/**
 * The address a gateway forwards for: in X-Forwarded-For, the one just before
 * the gateway's own (a CDN in front of the site appends it), or the last one
 * (the gateway connected directly). Earlier entries were written by whoever
 * sent the request to the gateway, they can't be trusted.
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
 * When the address is the verified egress of a corporate gateway, the gateway
 * (`address.proxy`) and the address it forwards for (`address.forwarded`).
 * The address stays the connecting one: `forwarded` is only a hint
 * @param {Log} log
 */
function gateway(log) {
  const egress = log.getIn(['address', 'value']);
  if (typeof egress !== 'string' || log.hasIn(['address', 'proxy'])) {
    return log;
  }
  const found = gateways.find(({ match }) => match(egress));
  if (!found) {
    return log;
  }
  log = log.setIn(['address', 'proxy'], found.name);
  const forwarded = forwardedFor(
    log.getIn(['request', 'headers', 'x-forwarded-for']),
    egress
  );
  return forwarded ? log.setIn(['address', 'forwarded'], forwarded) : log;
}

/** @param {Log} log */
function fill(log) {
  if (!log.hasIn(['address', 'value'])) {
    log = log.setIn(['address', 'value'], log.getIn(['request', 'address']));
  }
  return gateway(log);
}

function init() {
  pipeline.getNode('main').map(fill).registerNode('main');
}

function start() {
  aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  /** @type {Enricher} */
  const enricher = (entry, log) => {
    for (const field of [
      'address',
      'identity',
      'cloudflare',
      'dnsbl',
      'geoip',
      'hostname',
      'agent',
      'asn',
      'language',
      'signature',
    ]) {
      if (log.has(field) && !is(log.get(field), entry.get(field))) {
        entry = entry.set(field, log.get(field));
      }
    }

    // Distinct signature IDs with last-seen time, pruned to 24h; backs both
    // the 15m and 24h counts
    const signatureId = /** @type {string | undefined} */ (
      log.getIn(['signature', 'id'])
    );
    if (signatureId) {
      entry = entry.update(
        'signatures',
        (/** @type {RecentMap | undefined} */ map) => touch(map, signatureId)
      );
    }

    // Behind a gateway's egress: the distinct addresses it forwarded for
    const forwarded = /** @type {string | undefined} */ (
      log.getIn(['address', 'forwarded'])
    );
    if (forwarded) {
      entry = entry.update(
        'forwarded',
        (/** @type {RecentMap | undefined} */ map) => touch(map, forwarded)
      );
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

  aggregator.setEntryGc((entry) => {
    for (const key of ['signatures', 'forwarded']) {
      if (entry.has(key)) {
        entry = entry.update(key, prune);
      }
    }
    return entry;
  });

  // Identity and agent come from the latest log with one
  const { formatter } = aggregator;
  const identity = formatter.formats.find(([key]) => key === 'identity');
  const agent = formatter.formats.find(([key]) => key === 'agent');
  formatter.formats = formatter.formats.filter(
    (format) => format !== identity && format !== agent
  );
  // In HTML, the last identity falls back to the agent, in grey
  formatter.insertFormat(
    'lastIdentity',
    (entry, output) => {
      const value = identity ? identity[1](entry, output) : '';
      if (value || output !== 'html' || !agent) {
        return value;
      }
      const lastAgent = agent[1](entry, output);
      return lastAgent
        ? safeHtml(`<span class="grey">${toHtml(lastAgent)}</span>`)
        : '';
    },
    { after: 'hostname', color: formatter.colors.identity }
  );
  if (agent) {
    formatter.insertFormat('lastAgent', agent[1], {
      after: 'lastIdentity',
      color: formatter.colors.agent,
    });
  }

  // In HTML, addresses link to their logs
  formatter.replaceFormat('address', (entry, output) => {
    const address = /** @type {string} */ (
      entry.getIn(['address', 'value']) || ''
    );
    return output === 'html'
      ? safeHtml(html.logsLink('address', address))
      : address;
  });

  // The gateway an address is an egress of, and how many addresses it
  // forwarded for: one row, many clients
  aggregator.formatter.insertFormat(
    'proxy',
    (entry, output) => {
      const proxy = /** @type {string} */ (
        entry.getIn(['address', 'proxy']) || ''
      );
      const count = forwardedCount24h(entry);
      return output === 'html' && proxy && count
        ? safeHtml(
            `${toHtml(proxy)} <span class="grey">(${count} behind)</span>`
          )
        : proxy;
    },
    { after: 'address' }
  );
  aggregator.formatter.insertFormat('forwardedCount24h', forwardedCount24h, {
    before: 'count15m',
  });

  aggregator.formatter.insertFormat('signatureCount15m', signatureCount15m, {
    before: 'count15m',
  });
  aggregator.formatter.insertFormat('signatureCount24h', signatureCount24h, {
    before: 'count15m',
  });

  aggregator.sorters.signatureCount15m = signatureCount15m;
  aggregator.sorters.signatureCount24h = signatureCount24h;
  aggregator.sorters.forwardedCount24h = forwardedCount24h;

  pipeline
    .getNode('main')
    .map(
      (log) => /** @type {Aggregator} */ (aggregator).processLog(log),
      'aggregator'
    );

  api.registerAggregator('addresses', aggregator, {
    nav: true,
    identityFilter: true,
    columns: [
      'address',
      'proxy',
      'hostname',
      'country',
      'asn',
      'lastIdentity',
      'count',
      'execTime',
      'lastSeen',
    ],
  });
}

module.exports = {
  init,
  start,
  fill,
  forwardedFor,
  get aggregator() {
    return aggregator;
  },
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/aggregator').Enricher} Enricher */
/** @typedef {import('../lib/aggregator').Identifier} Identifier */
/** @typedef {import('../lib/aggregator').Sorter} Sorter */
/** @typedef {import('../lib/recent-map').RecentMap} RecentMap */
