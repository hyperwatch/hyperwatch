const cloudflare = require('./cloudflare');
const dnsbl = require('./dnsbl');
const hostname = require('./hostname');
const identity = require('./identity');
const proxy = require('./proxy');

module.exports = {
  cloudflare,
  dnsbl,
  hostname,
  identity,
  proxy,
};
