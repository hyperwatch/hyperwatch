const { Map } = require('immutable');
const proxyaddr = require('proxy-addr');

// Run `node scripts/fetch-cloudflare-ips.js` to update
const cloudflareIps = require('../data/cloudflare-ips.json');
// Run `node scripts/fetch-cloudfront-ips.js` to update
const cloudfrontIps = require('../data/cloudfront-ips.json');

const ipRanges = {
  cloudflare: cloudflareIps,
  cloudfront: cloudfrontIps,
  // To update: https://docs.sucuri.net/website-firewall/sucuri-firewall-troubleshooting-guide/
  sucuri: [
    '192.88.134.0/23',
    '185.93.228.0/22',
    '66.248.200.0/22',
    '2a02:fe80::/29',
    '208.109.0.0/22',
  ],
  // To update: https://docs-cybersec.thalesgroup.com/bundle/z-kb-articles-knowledgebase-support/page/290228110.html
  imperva: [
    '199.83.128.0/21',
    '198.143.32.0/19',
    '149.126.72.0/21',
    '103.28.248.0/22',
    '45.64.64.0/22',
    '185.11.124.0/22',
    '192.230.64.0/18',
    '107.154.0.0/16',
    '45.60.0.0/16',
    '45.223.0.0/16',
    '131.125.128.0/17',
    '2a02:e980::/29',
  ],
};

const trusted = ['loopback', 'linklocal', 'uniquelocal'].concat(
  ...Object.values(ipRanges)
);

/**
 * Detect the actual IP address, ignoring the proxies.
 */
function detectAddress(remoteAddress, headers) {
  let address = remoteAddress;

  if (headers.has('x-forwarded-for')) {
    address = proxyaddr(
      {
        headers: headers.toJS(),
        connection: { remoteAddress: remoteAddress },
      },
      trusted
    );
  }

  return Map({ value: address });
}

module.exports = {
  detectAddress: detectAddress,
};
