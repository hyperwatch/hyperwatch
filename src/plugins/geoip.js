const geoip = require('geoip-lite');
const { fromJS } = require('immutable');

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

module.exports = {
  lookup,
  augment,
};
