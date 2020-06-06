const { pick } = require('lodash');

const api = require('../app/api');
const {
  Aggregator,
  defaultMapper,
  defaultEnricher,
} = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

const identifier = (log) =>
  log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

let mapper = (entry) => pick(defaultMapper(entry), ['address', '15m', '24h']);
const setMapper = (fn) => (mapper = fn);

let enricher = defaultEnricher;
const setEnricher = (fn) => (enricher = fn);

function load() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);
  aggregator.setEnricher(enricher);
  aggregator.setMapper(mapper);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('addresses', aggregator);
}

module.exports = { load, setMapper, setEnricher };
