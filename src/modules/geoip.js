const { default: flag } = require('country-code-emoji');
const geoip = require('geoip-lite');
const { fromJS } = require('immutable');

const aggregator = require('../lib/aggregator');
const logger = require('../lib/logger');
const pipeline = require('../lib/pipeline');

function lookup(ip) {
  return geoip.lookup(ip);
}

function augment(log) {
  const ip =
    log.getIn(['address', 'value']) || log.getIn(['request', 'address']);

  const entry = lookup(ip);

  if (entry) {
    log = log.set('geoip', fromJS(entry));
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
};
