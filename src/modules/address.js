const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

const identifier = (log) => log.getIn(['address', 'value']);

function load() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier(identifier);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('addresses', aggregator);
}

function fill(log) {
  if (!log.hasIn(['address', 'value'])) {
    log = log.setIn(['address', 'value'], log.getIn(['request', 'address']));
  }
  return log;
}

function registerPipeline() {
  pipeline.getNode('main').map(fill).registerNode('main');
}

function register() {
  registerPipeline();
}

module.exports = {
  register,
  load,
};
