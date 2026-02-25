const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean);
}

async function main() {
  const ipv4 = await fetchLines('https://www.cloudflare.com/ips-v4/');
  const ipv6 = await fetchLines('https://www.cloudflare.com/ips-v6/');
  const cidrs = [...ipv4, ...ipv6];

  const filePath = path.join(dataDir, 'cloudflare-ips.json');
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(
    `cloudflare-ips: ${cidrs.length} CIDRs (${ipv4.length} IPv4, ${ipv6.length} IPv6)`
  );
}

main().catch(console.error);
