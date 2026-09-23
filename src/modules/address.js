const { is } = require('immutable');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');
const { touch, prune, countRecent } = require('../lib/recent-map');

const identifier = (log) => log.getIn(['address', 'value']);

const signatureCount15m = (entry) =>
  countRecent(entry.get('signatures'), 15 * 60);
const signatureCount24h = (entry) => countRecent(entry.get('signatures'));

let aggregator;

function fill(log) {
  if (!log.hasIn(['address', 'value'])) {
    log = log.setIn(['address', 'value'], log.getIn(['request', 'address']));
  }
  return log;
}

function init() {
  pipeline.getNode('main').map(fill).registerNode('main');
}

function start() {
  aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  const enricher = (entry, log) => {
    for (const field of [
      'address',
      'identity',
      'cloudflare',
      'dnsbl',
      'geoip',
      'hostname',
      'agent',
      'language',
      'signature',
    ]) {
      if (log.has(field) && !is(log.get(field), entry.get(field))) {
        entry = entry.set(field, log.get(field));
      }
    }

    // Distinct signature IDs with last-seen time, pruned to 24h; backs both
    // the 15m and 24h counts
    const signatureId = log.getIn(['signature', 'id']);
    if (signatureId) {
      entry = entry.update('signatures', (map) => touch(map, signatureId));
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

  aggregator.setEntryGc((entry) =>
    entry.has('signatures') ? entry.update('signatures', prune) : entry
  );

  aggregator.formatter.insertFormat('signatureCount15m', signatureCount15m, {
    before: 'count15m',
  });
  aggregator.formatter.insertFormat('signatureCount24h', signatureCount24h, {
    before: 'count15m',
  });

  aggregator.sorters.signatureCount15m = signatureCount15m;
  aggregator.sorters.signatureCount24h = signatureCount24h;

  pipeline
    .getNode('main')
    .map((log) => aggregator.processLog(log), 'aggregator');

  api.registerAggregator('addresses', aggregator);
}

module.exports = {
  init,
  start,
  get aggregator() {
    return aggregator;
  },
};
