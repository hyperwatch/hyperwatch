const { is } = require('immutable');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');
const { touch, prune } = require('../lib/recent-map');

const identifier = (log) => log.getIn(['address', 'value']);

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

    // Distinct signature IDs seen in the last 24h
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

  aggregator.formatter.insertFormat(
    'signatureCount',
    (entry) => (entry.has('signatures') ? entry.get('signatures').size : 0),
    { before: 'count15m' }
  );

  aggregator.sorters.signatureCount = (entry) =>
    entry.has('signatures') ? entry.get('signatures').size : 0;

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
