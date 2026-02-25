const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

async function main() {
  const response = await fetch(
    'https://ip-ranges.amazonaws.com/ip-ranges.json'
  );
  const ipRanges = await response.json();

  const ipv4 = ipRanges.prefixes
    .filter((p) => p.service === 'CLOUDFRONT')
    .map((p) => p.ip_prefix);

  const ipv6 = ipRanges.ipv6_prefixes
    .filter((p) => p.service === 'CLOUDFRONT')
    .map((p) => p.ipv6_prefix);

  const cidrs = [...ipv4, ...ipv6];

  const filePath = path.join(dataDir, 'cloudfront-ips.json');
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(
    `cloudfront-ips: ${cidrs.length} CIDRs (${ipv4.length} IPv4, ${ipv6.length} IPv6)`
  );
}

main().catch(console.error);
