const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// Anthropic publishes a single list covering all Claude crawlers
// (ClaudeBot, Claude-User, Claude-SearchBot).
const sources = [
  { name: 'claude-bot-ips', url: 'https://claude.com/crawling/bots.json' },
];

function extractCidrs(data) {
  const prefixes = Array.isArray(data) ? data : data.prefixes;
  if (!Array.isArray(prefixes)) {
    throw new Error('unexpected payload: no prefixes array');
  }
  return prefixes
    .map((prefix) => {
      if (typeof prefix === 'string') {
        return prefix;
      }
      return prefix.ipv4Prefix || prefix.ipv6Prefix || prefix.ip_prefix;
    })
    .filter(Boolean)
    .map((cidr) => {
      if (cidr.includes('/')) {
        return cidr;
      }
      return cidr.includes(':') ? `${cidr}/128` : `${cidr}/32`;
    });
}

async function fetchAndStore({ name, url }) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${name}: ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }
  const cidrs = extractCidrs(await res.json());
  if (cidrs.length === 0) {
    console.error(`Failed to fetch ${name}: empty list, keeping current file`);
    process.exitCode = 1;
    return;
  }
  const filePath = path.join(dataDir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${name}: ${cidrs.length} CIDRs`);
}

async function main() {
  for (const source of sources) {
    await fetchAndStore(source);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
