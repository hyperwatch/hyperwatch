const cloudflare = require('./cloudflare');
const dnsbl = require('./dnsbl');
const proxy = require('./proxy');

module.exports = {
  cloudflare,
  dnsbl,
  proxy,
};
