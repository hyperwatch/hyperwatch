const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

const identifier = (log) =>
  log.getIn(['identity']) ||
  log.getIn(['address', 'value']) ||
  log.getIn(['request', 'address']);

function load() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('identities', aggregator);
}

module.exports = { load };
