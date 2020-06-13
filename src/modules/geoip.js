const countryCodeEmoji = require('country-code-emoji');
const geoip = require('geoip-lite');
const { fromJS } = require('immutable');

const aggregator = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');
const logs = require('../modules/logs');

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
    return output === 'html' ? `${countryCodeEmoji(cc)} ${cc}` : cc;
  }
};

function registerFormatters() {
  aggregator.defaultFormatter.insertFormat('country', country, {
    after: 'address',
    color: 'grey',
  });
  aggregator.defaultFormatter.insertFormat('city', city, {
    after: 'country',
    color: 'grey',
  });
  logs.formatter.insertFormat('country', country, {
    after: 'address',
    color: 'grey',
  });
}

function registerPipeline() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function register() {
  registerPipeline();
  registerFormatters();
}

module.exports = {
  register,
  lookup,
  augment,
  registerFormatters,
};
