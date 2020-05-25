const cloudflare = require('./cloudflare');
const geoip = require('./geoip');
const hostname = require('./hostname');
const proxy = require('./proxy');
const dnsbl = require('./dnsbl');

module.exports = { proxy, geoip, hostname, cloudflare, dnsbl };
