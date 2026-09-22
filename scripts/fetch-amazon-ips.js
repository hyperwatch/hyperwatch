const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// Amazon publishes these lists as JSON embedded in HTML pages.
const sources = [
  {
    name: 'amazonbot-ips',
    url: 'https://developer.amazon.com/amazonbot/ip-addresses/',
  },
  {
    name: 'amazon-user-ips',
    url: 'https://developer.amazon.com/amazonbot/live-ip-addresses/',
  },
  {
    name: 'amazon-searchbot-ips',
    url: 'https://developer.amazon.com/amazonbot/searchbot-ip-addresses/',
  },
];

async function fetchAndStore({ name, url }) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${name}: ${res.status} ${res.statusText}`);
    return;
  }
  const html = await res.text();
  const match = html.match(
    /<code[^>]*>\s*(\{[\s\S]*?"prefixes"[\s\S]*?\})\s*<\/code>/
  );
  if (!match) {
    console.error(`Failed to find prefixes JSON for ${name}`);
    return;
  }
  const data = JSON.parse(match[1]);
  const cidrs = data.prefixes
    .map((p) => {
      const cidr = p.ipv4Prefix || p.ip_prefix;
      return cidr.includes('/') ? cidr : `${cidr}/32`;
    })
    .sort();
  const filePath = path.join(dataDir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${name}: ${cidrs.length} CIDRs`);
}

async function main() {
  for (const source of sources) {
    await fetchAndStore(source);
  }
}

main().catch(console.error);
