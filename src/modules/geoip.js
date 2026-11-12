const { default: flag } = require('country-code-emoji');
const geoip = require('geoip-lite');
const { fromJS } = require('immutable');

const constants = require('../constants');
const aggregator = require('../lib/aggregator');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');

// What a log keeps of the lookup by default: it's copied into logs, history
// and aggregator entries, and these are the fields shown
const DEFAULT_FIELDS = ['country', 'region', 'city'];

/**
 * The fields of the lookup kept in logs: `modules.geoip.fields`, a list of
 * fields (e.g. ["country", "region", "city", "timezone", "ll"]), or "all"
 * for the whole lookup (also with ll, range, metro, area, eu, timezone).
 * Null means all.
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

let fields = DEFAULT_FIELDS;

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
  return geoip.lookup(ip);
}

function pick(entry) {
  if (!fields) {
    return entry;
  }
  const picked = {};
  for (const field of fields) {
    if (entry[field] !== undefined) {
      picked[field] = entry[field];
    }
  }
  return picked;
}

function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = lookup(ip);

  if (entry) {
    log = log.set('geoip', fromJS(pick(entry)));
  }

  return log;
}

const city = (log) => {
  return log.getIn(['geoip', 'city']);
};

const country = (log, output) => {
  const cc = log.getIn(['geoip', 'country']);
  if (cc) {
    return output === 'html' ? `${flag(cc)} ${cc}` : cc;
  }
};

function init() {
  fields = fieldsFor(constants.modules.geoip);

  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('country', country, {
    after: 'address',
    color: 'grey',
  });
  aggregator.defaultFormatter.insertFormat('city', city, {
    after: 'country',
    color: 'grey',
  });
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
};
