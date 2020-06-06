const cloudflare = require('./cloudflare');
const dnsbl = require('./dnsbl');
const geoip = require('./geoip');
const hostname = require('./hostname');
const identity = require('./identity');
const proxy = require('./proxy');
const useragent = require('./useragent');

module.exports = {
  cloudflare,
  dnsbl,
  geoip,
  hostname,
  identity,
  proxy,
  useragent,
};
