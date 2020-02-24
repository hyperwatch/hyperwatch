const geoip = require('geoip-lite');
const { fromJS } = require('immutable');

function lookup(log) {
  const ip = log.getIn(['address', 'value']);
  const geoipLookup = geoip.lookup(ip);
  return log.setIn(['address', 'geoip'], fromJS(geoipLookup));
}

module.exports = {
  lookup: lookup,
};
