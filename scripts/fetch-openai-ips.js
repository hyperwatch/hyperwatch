const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

const sources = [
  { name: 'chatgpt-user-ips', url: 'https://openai.com/chatgpt-user.json' },
  { name: 'gptbot-ips', url: 'https://openai.com/gptbot.json' },
  { name: 'openai-searchbot-ips', url: 'https://openai.com/searchbot.json' },
];

async function fetchAndStore({ name, url }) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${name}: ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }
  const data = await res.json();
  const cidrs = data.prefixes.map((p) => {
    const cidr = p.ipv4Prefix || p.ip_prefix;
    return cidr.includes('/') ? cidr : `${cidr}/32`;
  });
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
