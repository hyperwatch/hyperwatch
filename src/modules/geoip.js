const fs = require('fs');
const os = require('os');
const path = require('path');

const { default: flag } = require('country-code-emoji');

const constants = require('../constants');
const aggregator = require('../lib/aggregator');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');
const { sharedFromJS } = require('../lib/shared');

// What a log keeps of the lookup by default: it's copied into logs, history
// and aggregator entries. The country only: it needs geoip-lite's country
// tables (6.5 MB in memory), region and city its city tables (110 MB)
const DEFAULT_FIELDS = ['country'];

/**
 * The fields of the lookup kept in logs: `modules.geoip.fields`, a list of
 * fields (e.g. ["country", "region", "city", "timezone", "ll"]), or "all"
 * for the whole lookup (also with ll, range, metro, area, eu, timezone).
 * Null means all.
 * @param {ModuleConfig} [config]
 * @returns {string[] | null}
 */
function fieldsFor(config = {}) {
  const { fields } = config;
  if (fields === undefined) {
    return DEFAULT_FIELDS;
  }
  if (fields === 'all') {
    return null;
  }
  if (Array.isArray(fields) && fields.every((f) => typeof f === 'string')) {
    return fields;
  }
  if (typeof fields === 'string' && fields.trim()) {
    // From the environment (rc): "country,region,city"
    return fields.split(',').map((f) => f.trim());
  }
  console.warn(`Invalid modules.geoip.fields "${fields}": using the default.`);
  return DEFAULT_FIELDS;
}

/** @type {string[] | null} */
let fields = DEFAULT_FIELDS;

// What geoip-lite's country tables give: every other field needs its city
// tables
const COUNTRY_FIELDS = ['country', 'range'];

/**
 * Whether fields need geoip-lite's city tables (about 110 MB in memory,
 * against 6.5 MB for the country tables)
 * @param {string[] | null} fields null: all
 * @returns {boolean}
 */
const needsCities = (fields) =>
  !fields || fields.some((field) => !COUNTRY_FIELDS.includes(field));

/**
 * geoip-lite, as loaded by geoipLite()
 * @typedef {{ lookup: (ip: string) => GeoipLookup | null }} Geoip
 */

/** @type {{ geoip: Geoip, cities: boolean } | null} */
let loaded = null;

const GEOIP_FILES = ['geoip-country.dat', 'geoip-country6.dat'];

/**
 * geoip-lite with its country tables only. It reads its tables when
 * required, from `global.geodatadir`, and falls back to the country tables
 * when the city tables aren't there: it's given a directory with only
 * those, removed once read.
 * @returns {Geoip}
 */
function requireCountries() {
  const main = require.resolve('geoip-lite');
  /** @type {{ geodatadir?: string }} */
  const global = /** @type {any} */ (globalThis);
  const previous = global.geodatadir;
  // Where geoip-lite would read its tables (see its lib/geoip.js)
  const source = path.resolve(
    path.dirname(main),
    previous || process.env.GEODATADIR || '../data/'
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-geoip-'));
  try {
    for (const file of GEOIP_FILES) {
      fs.copyFileSync(path.join(source, file), path.join(dir, file));
    }
    global.geodatadir = dir;
    return require('geoip-lite');
  } finally {
    if (previous === undefined) {
      delete global.geodatadir;
    } else {
      global.geodatadir = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * geoip-lite, loaded with the tables the fields need: the city tables only
 * when a field isn't in the country tables
 * @returns {Geoip}
 */
function geoipLite() {
  const cities = needsCities(fields);
  if (loaded && (loaded.cities || !cities)) {
    return loaded.geoip;
  }
  if (loaded) {
    // Fields needing the city tables after a load without them (tests)
    delete require.cache[require.resolve('geoip-lite')];
  }
  loaded = {
    geoip: cities ? require('geoip-lite') : requireCountries(),
    cities,
  };
  return loaded.geoip;
}

/**
 * What geoip-lite knows of an address (declared here, so the published types
 * don't need geoip-lite's)
 * @typedef {object} GeoipLookup
 * @property {string} country Two letters (ISO 3166-1)
 * @property {string} region
 * @property {string} city
 * @property {string} timezone
 * @property {[number, number]} ll Latitude and longitude
 * @property {[number, number]} range
 * @property {string} eu `'1'` in the European Union
 * @property {number} metro
 * @property {number} area Accuracy radius, in kilometers
 */

/**
 * @param {string} ip
 * @returns {GeoipLookup | null}
 */
function lookup(ip) {
  return geoipLite().lookup(ip);
}

/**
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function pick(entry) {
  if (!fields) {
    return entry;
  }
  /** @type {Record<string, unknown>} */
  const picked = {};
  for (const field of fields) {
    if (entry[field] !== undefined) {
      picked[field] = entry[field];
    }
  }
  return picked;
}

/** @param {Log} log */
function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = lookup(/** @type {string} */ (ip));

  if (entry) {
    // One value per country (or per lookup with more fields), shared
    log = log.set('geoip', sharedFromJS('geoip', pick(entry)));
  }

  return log;
}

/** @type {Format} */
const city = (log) => {
  return log.getIn(['geoip', 'city']);
};

/** @type {Format} */
const country = (log, output) => {
  const cc = /** @type {string | undefined} */ (
    log.getIn(['geoip', 'country'])
  );
  if (cc) {
    return output === 'html' ? `${flag(cc)} ${cc}` : cc;
  }
};

function init() {
  fields = fieldsFor(constants.modules.geoip);
  // Loaded now rather than at the first log
  geoipLite();

  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('country', country, {
    after: 'address',
    color: 'grey',
  });
  // A column only when logs have the city
  if (!fields || fields.includes('city')) {
    aggregator.defaultFormatter.insertFormat('city', city, {
      after: 'country',
      color: 'grey',
    });
  }
  logger.defaultFormatter.insertFormat('country', country, {
    after: 'address',
    color: 'grey',
  });
}

module.exports = {
  lookup,
  init,
  augment,
  fieldsFor,
  needsCities,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../types').ModuleConfig} ModuleConfig */
/** @typedef {import('../lib/formatter').Format} Format */
