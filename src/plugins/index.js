const cloudflare = require('./cloudflare');
const dnsbl = require('./dnsbl');
const geoip = require('./geoip');
const hostname = require('./hostname');
const proxy = require('./proxy');

module.exports = { cloudflare, dnsbl, geoip, hostname, proxy };
