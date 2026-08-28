const { is, Set } = require('immutable');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

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

    // Collect unique signature IDs
    const signatureId = log.getIn(['signature', 'id']);
    if (signatureId) {
      const signatures = entry.get('signatures');
      if (!signatures || !(signatures instanceof Set)) {
        entry = entry.set('signatures', new Set([signatureId]));
      } else if (!signatures.has(signatureId)) {
        entry = entry.set('signatures', signatures.add(signatureId));
      }
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

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
