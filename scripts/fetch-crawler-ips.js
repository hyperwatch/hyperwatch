const fs = require('fs');
const path = require('path');

const { compileRanges } = require('../src/lib/cidr');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// Address lists crawler and monitoring operators publish, used by the identity
// module. Each source is JSON with a `prefixes` array (`ipv4Prefix`,
// `ipv6Prefix`, `ip_prefix` or `ipv6_prefix`; the Googlebot format), JSON with a `data`
// array of addresses, or plain text with one address per line.
const sources = [
  {
    name: 'ahrefs-ips',
    urls: ['https://api.ahrefs.com/v3/public/crawler-ip-ranges'],
  },
  {
    name: 'applebot-ips',
    urls: ['https://search.developer.apple.com/applebot.json'],
  },
  {
    name: 'barkrowler-ips',
    urls: ['https://www.babbar.tech/barkrowler-ip-ranges.json'],
  },
  { name: 'bingbot-ips', urls: ['https://www.bing.com/toolbox/bingbot.json'] },
  {
    name: 'discord-ips',
    urls: ['https://cdn.discordapp.com/ipranges/discord.json'],
  },
  {
    name: 'duckassistbot-ips',
    urls: ['https://duckduckgo.com/duckassistbot.json'],
  },
  {
    name: 'duckduckbot-ips',
    urls: ['https://duckduckgo.com/duckduckbot.json'],
  },
  { name: 'lyrenth-ips', urls: ['https://lyrenth.com/bot/ip-ranges.json'] },
  { name: 'mojeekbot-ips', urls: ['https://www.mojeek.com/mojeekbot.json'] },
  {
    name: 'naverbot-ips',
    urls: ['https://searchadvisor.naver.com/doc/naverbot.json'],
  },
  {
    name: 'pingdom-ips',
    urls: [
      'https://my.pingdom.com/probes/ipv4',
      'https://my.pingdom.com/probes/ipv6',
    ],
  },
  { name: 'qwantbot-ips', urls: ['https://help.qwant.com/qwantbot.json'] },
  {
    name: 'seekportbot-ips',
    urls: ['https://bot.seekport.com/seekportbot_ips.txt'],
  },
  {
    name: 'seranking-ips',
    urls: ['https://api.seranking.com/backlinks-bot-ips'],
  },
  {
    name: 'seznambot-ips',
    urls: ['https://search.seznam.cz/ipranges/seznambot.json'],
  },
  {
    name: 'sentry-uptime-ips',
    urls: ['https://sentry.io/api/0/uptime-ips/'],
  },
  {
    name: 'shapbot-ips',
    urls: ['https://docs.parallel.ai/resources/shapbot.json'],
  },
  { name: 'sofyabot-ips', urls: ['https://sofya.co/bot/ips.json'] },
  {
    name: 'uptimerobot-ips',
    urls: ['https://api.uptimerobot.com/meta/ips'],
  },
];

function toCidr(value) {
  if (value.includes('/')) {
    return value;
  }
  return value.includes(':') ? `${value}/128` : `${value}/32`;
}

function extract(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    // Not JSON: plain text, one address per line
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (Array.isArray(data.data)) {
    return data.data;
  }
  if (!Array.isArray(data.prefixes)) {
    throw new Error('unexpected payload: no prefixes or data array');
  }
  return data.prefixes
    .map(
      (prefix) =>
        prefix.ipv4Prefix ||
        prefix.ipv6Prefix ||
        prefix.ip_prefix ||
        prefix.ipv6_prefix
    )
    .filter(Boolean);
}

async function fetchAndStore({ name, urls }) {
  const cidrs = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${url}: ${res.status} ${res.statusText}`);
    }
    cidrs.push(...extract(await res.text()).map(toCidr));
  }
  if (cidrs.length === 0) {
    throw new Error('empty list');
  }
  // Throws on anything that isn't an address or a range
  compileRanges(cidrs);
  const filePath = path.join(dataDir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${name}: ${cidrs.length} CIDRs`);
}

async function main() {
  // Each list is kept as is when its source fails
  for (const source of sources) {
    try {
      await fetchAndStore(source);
    } catch (error) {
      console.error(
        `Failed to fetch ${source.name}, keeping current file:`,
        error.message
      );
      process.exitCode = 1;
    }
  }
}

main();
