// The autonomous system (network) of each client address: logs get
// asn: { number, organization, country }, and /asns counts traffic per AS.
//
// The table comes from @hyperwatch/iptoasn (iptoasn.com's ip2asn-combined,
// public domain, released daily when it changes), an optional peer
// dependency: the application installs it, and keeps it up to date, to use
// this module. Nothing is downloaded at run time. Lookups are synchronous: a
// bisection over typed arrays, behind an LRU of addresses, and one value per
// range shared by all its addresses.

const { fromJS } = require('immutable');
const { LRUCache } = require('lru-cache');

const api = require('../app/api');
const constants = require('../constants');
const { Aggregator, defaultFormatter, lastSeen } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { touch, prune, countRecent } = require('../lib/recent-map');
const {
  aggregateCount,
  aggregateSum,
  formatDuration,
  safeHtml,
  toHtml,
} = require('../lib/util');

/** @typedef {import('../types').Log} Log */
/**
 * What this module uses of @hyperwatch/iptoasn's tables, declared here: the
 * published declarations can't refer to an optional peer dependency
 * @typedef {object} AsnTable
 * @property {(address: unknown) => number} find The index of the address's
 *   range, -1 when none
 * @property {(index: number) => { number: number, organization: string, country?: string }} range
 * @property {number} size
 * @property {string} source
 */
/** @typedef {import('immutable').Map<string, unknown>} AsnValue */

/** @returns {import('../types').ModuleConfig} */
function config() {
  return constants.modules.asn || {};
}

/** @type {AsnTable | null} */
let table = null;

// Address → range index (-1: in no range). Cleared with the table.
/** @type {LRUCache<string, number>} */
let addresses = new LRUCache({ max: 10000 });

// Range index → the value logs get, built once per range
/** @type {Map<number, AsnValue>} */
let values = new Map();

/**
 * Uses a table (tests, or a table built elsewhere). null: no lookups.
 * @param {AsnTable | null} next
 */
function setTable(next) {
  table = next;
  addresses = new LRUCache({ max: Number(config().cacheSize) || 10000 });
  values = new Map();
}

/**
 * What logs get for an address, null when unknown
 * @param {unknown} address
 * @returns {AsnValue | null}
 */
function lookup(address) {
  if (!table || typeof address !== 'string') {
    return null;
  }
  const cached = addresses.get(address);
  const index = cached === undefined ? table.find(address) : cached;
  if (cached === undefined) {
    addresses.set(address, index);
  }
  if (index === -1) {
    return null;
  }
  let value = values.get(index);
  if (!value) {
    value = /** @type {AsnValue} */ (fromJS(table.range(index)));
    values.set(index, value);
  }
  return value;
}

// The client address: address.value (address and cloudflare modules), else
// the address of the request, as inputs give it
/**
 * @param {Log} log
 * @returns {string | undefined}
 */
const addressOf = (log) =>
  log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

/** @param {Log} log */
function augment(log) {
  const value = lookup(addressOf(log));
  return value ? log.set('asn', value) : log;
}

/** @type {Promise<void> | null} */
let loading = null;

const PACKAGE = '@hyperwatch/iptoasn';

// Loads the table of @hyperwatch/iptoasn, when installed (start() does it;
// exported for tests, with another require)
async function load(requireTable = require) {
  /** @type {{ load: () => Promise<AsnTable> }} */
  let iptoasn;
  try {
    iptoasn = requireTable(PACKAGE);
  } catch (/** @type {any} */ err) {
    // Not a missing dependency of the package itself
    if (err.code !== 'MODULE_NOT_FOUND' || !err.message.includes(PACKAGE)) {
      throw err;
    }
    console.warn(
      `asn: the module needs ${PACKAGE}, not installed: npm install ${PACKAGE}`
    );
    return;
  }
  try {
    setTable(await iptoasn.load());
  } catch (/** @type {any} */ err) {
    console.warn(`asn: couldn't load the table of ${PACKAGE}: ${err.message}`);
  }
}

/** Resolves once the table is loaded (well under a second) */
function ready() {
  return loading || Promise.resolve();
}

// Formats and aggregator

/**
 * @param {import('immutable').Map<string, any>} entry
 * @returns {string}
 */
const asnLabel = (entry) => {
  const number = entry.getIn(['asn', 'number']);
  return number ? `AS${number}` : '';
};

/** @type {import('../lib/formatter').Format} */
const asnFormat = (entry, output) => {
  const label = asnLabel(entry);
  if (!label || output !== 'html') {
    return label;
  }
  const organization = entry.getIn(['asn', 'organization']) || '';
  return safeHtml(
    `<span title="${toHtml(organization)}">${toHtml(label)}</span>`
  );
};

/** @type {import('../lib/aggregator').Sorter} */
const addressCount15m = (entry) => countRecent(entry.get('addresses'), 15 * 60);
/** @type {import('../lib/aggregator').Sorter} */
const addressCount24h = (entry) => countRecent(entry.get('addresses'));

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');

  // An `asn` column for aggregators of addresses (/addresses)
  defaultFormatter.insertFormat('asn', asnFormat, {
    after: 'hostname',
    color: 'grey',
  });
}

/** @type {Aggregator | undefined} */
let _aggregator;

function start() {
  // Once per process: the table doesn't change while it runs
  loading = table ? Promise.resolve() : load();

  const aggregator = (_aggregator = new Aggregator());
  aggregator.setIdentifier((log) => {
    const number = log.getIn(['asn', 'number']);
    return number ? String(number) : undefined;
  });
  aggregator.setEnricher((entry, log) => {
    entry = entry.set('asn', log.get('asn'));
    // Counted without the address module too, as augment() looks it up
    const address = addressOf(log);
    return address
      ? entry.update('addresses', (map) => touch(map, address))
      : entry;
  });
  aggregator.setEntryGc((entry) =>
    entry.has('addresses') ? entry.update('addresses', prune) : entry
  );

  const formatter = new Formatter();
  formatter.setFormats([
    ['asn', asnFormat],
    ['organization', (entry) => entry.getIn(['asn', 'organization']) || ''],
    ['country', (entry) => entry.getIn(['asn', 'country']) || ''],
    ['addressCount15m', addressCount15m],
    ['addressCount24h', addressCount24h],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],
    [
      'execTime15m',
      (entry) => formatDuration(aggregateSum(entry, 'per_minute')),
    ],
    ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],
    ['lastSeen', lastSeen],
  ]);
  aggregator.setFormatter(formatter);
  aggregator.sorters.addressCount15m = addressCount15m;
  aggregator.sorters.addressCount24h = addressCount24h;

  pipeline
    .getNode('main')
    .filter((log) => log.has('asn'))
    .map((log) => aggregator.processLog(log), 'aggregator');

  api.registerAggregator('asns', aggregator, {
    nav: true,
    columns: [
      'asn',
      'organization',
      'country',
      'addressCount',
      'count',
      'execTime',
      'lastSeen',
    ],
  });
}

module.exports = {
  augment,
  init,
  load,
  lookup,
  ready,
  setTable,
  start,
  get aggregator() {
    return _aggregator;
  },
};
