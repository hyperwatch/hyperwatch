/**
 * The address lists operators publish, fetched into src/data/<name>.json by
 * scripts/fetch-ips.js. Each source has one or more URLs and a parser that
 * reads the addresses and ranges from the response's text.
 *
 * A list is only written when every URL was fetched and parsed, the result
 * isn't empty and every entry is a valid address or range: otherwise the
 * current file is kept and the source is reported as failed.
 */
const net = require('net');

const { compileRanges, inRange, parseCidr } = require('../../src/lib/cidr');

// A bare address as a single-host range
function toCidr(value) {
  if (value.includes('/')) {
    return value;
  }
  return value.includes(':') ? `${value}/128` : `${value}/32`;
}

// JSON with a `prefixes` array of strings or objects (`ipv4Prefix`,
// `ipv6Prefix`, `ip_prefix` or `ipv6_prefix`, several in one object
// sometimes): the Googlebot format, which most operators follow. A bare array
// is read the same way.
function parsePrefixes(text) {
  const data = JSON.parse(text);
  const prefixes = Array.isArray(data) ? data : data.prefixes;
  if (!Array.isArray(prefixes)) {
    throw new Error('unexpected payload: no prefixes array');
  }
  const keys = ['ipv4Prefix', 'ipv6Prefix', 'ip_prefix', 'ipv6_prefix'];
  return prefixes
    .flatMap((prefix) =>
      typeof prefix === 'string' ? [prefix] : keys.map((key) => prefix[key])
    )
    .filter(Boolean);
}

// JSON with a `data` array of addresses
function parseData(text) {
  const { data } = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('unexpected payload: no data array');
  }
  return data;
}

// JSON with a `results` array of objects with `cidr` and `service`: the
// ranges of one service (HubSpot's network origins API)
function parseResults(service) {
  return (text) => {
    const { results } = JSON.parse(text);
    if (!Array.isArray(results)) {
      throw new Error('unexpected payload: no results array');
    }
    return results
      .filter((result) => result.service === service)
      .map((result) => result.cidr);
  };
}

// The IPv4 addresses in the first HTML table row whose first cell is `label`
function parseTableRow(label) {
  return (text) => {
    const start = text.indexOf(`>${label}<`);
    if (start < 0) {
      throw new Error(`unexpected page: no "${label}" row`);
    }
    const row = text.slice(start, text.indexOf('</tr>', start));
    return row.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
  };
}

// Plain text, one address or range per line
function parseLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// JSON with one array of ranges per key (GitHub's meta API)
function parseKeys(keys) {
  return (text) => {
    const data = JSON.parse(text);
    return keys.flatMap((key) => {
      if (!Array.isArray(data[key])) {
        throw new Error(`unexpected payload: no "${key}" array`);
      }
      return data[key].filter((range) => typeof range === 'string');
    });
  };
}

// AWS's ip-ranges.json, the ranges of one service, IPv4 first
function parseAwsService(service) {
  return (text) => {
    const data = JSON.parse(text);
    if (!Array.isArray(data.prefixes) || !Array.isArray(data.ipv6_prefixes)) {
      throw new Error('unexpected payload: no prefixes arrays');
    }
    return [
      ...data.prefixes
        .filter((prefix) => prefix.service === service)
        .map((prefix) => prefix.ip_prefix),
      ...data.ipv6_prefixes
        .filter((prefix) => prefix.service === service)
        .map((prefix) => prefix.ipv6_prefix),
    ];
  };
}

// The `route:` and `route6:` objects of a whois response
function parseRoutes(text) {
  return text
    .split('\n')
    .map((line) => line.match(/^route6?:\s+(\S+)/))
    .filter(Boolean)
    .map((match) => match[1]);
}

// Ranges inside another range of the list are left out: many routes are more
// specific announcements of a larger one
function removeNested(cidrs) {
  const ranges = cidrs.map((cidr) => {
    const [address, bits] = cidr.split('/');
    return { address, bits: Number(bits), range: parseCidr(cidr) };
  });
  return cidrs.filter((cidr, i) => {
    const { address, bits } = ranges[i];
    return !ranges.some(
      (other, j) =>
        j !== i &&
        other.bits <= bits &&
        // Same prefix length: the same range written twice, keep the first
        (other.bits < bits || j < i) &&
        inRange(other.range, address)
    );
  });
}

const sources = [
  // Crawlers and fetchers, for the identity module
  {
    name: 'ahrefs-ips',
    urls: ['https://api.ahrefs.com/v3/public/crawler-ip-ranges'],
    parse: parsePrefixes,
  },
  {
    name: 'applebot-ips',
    urls: ['https://search.developer.apple.com/applebot.json'],
    parse: parsePrefixes,
  },
  // Arquivo.pt's web archive crawler
  {
    name: 'arquivo-ips',
    urls: ['https://arquivo.pt/crawlerips.json'],
    parse: parsePrefixes,
  },
  {
    name: 'barkrowler-ips',
    urls: ['https://www.babbar.tech/barkrowler-ip-ranges.json'],
    parse: parsePrefixes,
  },
  {
    name: 'bingbot-ips',
    urls: ['https://www.bing.com/toolbox/bingbot.json'],
    parse: parsePrefixes,
  },
  // CCBot (Common Crawl)
  {
    name: 'ccbot-ips',
    urls: ['https://index.commoncrawl.org/ccbot.json'],
    parse: parsePrefixes,
  },
  // OpenAI, one list per agent
  {
    name: 'chatgpt-user-ips',
    urls: ['https://openai.com/chatgpt-user.json'],
    parse: parsePrefixes,
  },
  // Anthropic: one list for all Claude crawlers (ClaudeBot, Claude-User,
  // Claude-SearchBot)
  {
    name: 'claude-bot-ips',
    urls: ['https://claude.com/crawling/bots.json'],
    parse: parsePrefixes,
  },
  {
    name: 'discord-ips',
    urls: ['https://cdn.discordapp.com/ipranges/discord.json'],
    parse: parsePrefixes,
  },
  {
    name: 'duckassistbot-ips',
    urls: ['https://duckduckgo.com/duckassistbot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'duckduckbot-ips',
    urls: ['https://duckduckgo.com/duckduckbot.json'],
    parse: parsePrefixes,
  },
  // The ranges GitHub runs its own services from (web, API, webhooks, git,
  // Pages, Packages, importers, Copilot), where github-camo, the image proxy
  // behind README badges, comes from. The `actions` ranges are left out:
  // Actions runners there run any GitHub user's workflows.
  // https://docs.github.com/en/rest/meta/meta
  {
    name: 'github-ips',
    urls: ['https://api.github.com/meta'],
    headers: { accept: 'application/vnd.github+json' },
    parse: parseKeys([
      'hooks',
      'web',
      'api',
      'git',
      'pages',
      'packages',
      'importer',
      'github_enterprise_importer',
      'copilot',
    ]),
  },
  // Google publishes the ranges of its crawlers and fetchers at
  // https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers.
  {
    name: 'googlebot-ips',
    urls: [
      'https://developers.google.com/static/crawling/ipranges/common-crawlers.json',
    ],
    parse: parsePrefixes,
  },
  // The fetchers acting on a user's request, shared by every user. Google
  // Apps Script (UrlFetchApp) fetches from them, e.g. 34.116.28.0/27.
  {
    name: 'google-user-triggered-fetchers-ips',
    urls: [
      'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
    ],
    parse: parsePrefixes,
  },
  {
    name: 'gptbot-ips',
    urls: ['https://openai.com/gptbot.json'],
    parse: parsePrefixes,
  },
  // HaloScan publishes HaloBot's addresses in a table on its crawler page
  {
    name: 'halobot-ips',
    urls: ['https://www.haloscan.com/en/crawler-haloscan'],
    parse: parseTableRow('Official IP addresses'),
  },
  // HubSpot's crawling and user-generated traffic (`WEB_SCRAPING`), from its
  // network origins API (https://developers.hubspot.com/docs/api/network-origins)
  {
    name: 'hubspot-ips',
    urls: ['https://api.hubapi.com/meta/network-origins/2026-09/ip-ranges'],
    parse: parseResults('WEB_SCRAPING'),
  },
  // ibou, one list per crawler (https://www.ibou.com/crawlers.html,
  // https://www.ibou.com/iboubot.html)
  {
    name: 'ibou-ips',
    urls: ['https://www.ibou.com/ibousearch-ip-ranges.json'],
    parse: parsePrefixes,
  },
  {
    name: 'iboubot-ips',
    urls: ['https://www.ibou.com/iboubot-ip-ranges.json'],
    parse: parsePrefixes,
  },
  // Keenable, one list per agent (https://keenable.ai/bot)
  {
    name: 'keenable-user-ips',
    urls: ['https://app.keenable.ai/bot/keenable-user.json'],
    parse: parsePrefixes,
  },
  {
    name: 'keenablebot-ips',
    urls: ['https://app.keenable.ai/bot/keenablebot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'lyrenth-ips',
    urls: ['https://lyrenth.com/bot/ip-ranges.json'],
    parse: parsePrefixes,
  },
  // Meta publishes no list: its crawler documentation
  // (https://developers.facebook.com/docs/sharing/webmasters/web-crawlers)
  // points to the routes of its network, AS32934, in the RADb registry.
  {
    name: 'meta-ips',
    urls: ['whois://whois.radb.net/-i origin AS32934'],
    parse: (text) => removeNested(parseRoutes(text)),
  },
  {
    name: 'mojeekbot-ips',
    urls: ['https://www.mojeek.com/mojeekbot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'naverbot-ips',
    urls: ['https://searchadvisor.naver.com/doc/naverbot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'openai-searchbot-ips',
    urls: ['https://openai.com/searchbot.json'],
    parse: parsePrefixes,
  },
  // Perplexity, one list per agent: PerplexityBot (its crawler) and
  // Perplexity-User (fetches made for a user's question)
  {
    name: 'perplexity-user-ips',
    urls: ['https://www.perplexity.com/perplexity-user.json'],
    parse: parsePrefixes,
  },
  {
    name: 'perplexitybot-ips',
    urls: ['https://www.perplexity.com/perplexitybot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'pingdom-ips',
    urls: [
      'https://my.pingdom.com/probes/ipv4',
      'https://my.pingdom.com/probes/ipv6',
    ],
    parse: parseLines,
  },
  {
    name: 'qwantbot-ips',
    urls: ['https://help.qwant.com/qwantbot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'reflectionbot-ips',
    urls: ['https://reflection.ai/bot/ips.json'],
    parse: parsePrefixes,
  },
  {
    name: 'rootcrawl-ips',
    urls: ['https://rootcrawl.org/.well-known/rootcrawl-crawler-ips.json'],
    parse: parsePrefixes,
  },
  {
    name: 'seekportbot-ips',
    urls: ['https://bot.seekport.com/seekportbot_ips.txt'],
    parse: parseLines,
  },
  {
    name: 'sentry-uptime-ips',
    urls: ['https://sentry.io/api/0/uptime-ips/'],
    parse: parseLines,
  },
  {
    name: 'seranking-ips',
    urls: [
      'https://api.seranking.com/backlinks-bot-ips',
      'https://api.seranking.com/backlinks-bot-ips?v=6',
    ],
    parse: parseData,
  },
  {
    name: 'seznambot-ips',
    urls: ['https://search.seznam.cz/ipranges/seznambot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'shapbot-ips',
    urls: ['https://docs.parallel.ai/resources/shapbot.json'],
    parse: parsePrefixes,
  },
  {
    name: 'sofyabot-ips',
    urls: ['https://sofya.co/bot/ips.json'],
    parse: parsePrefixes,
  },
  {
    name: 'uptimerobot-ips',
    urls: ['https://api.uptimerobot.com/meta/ips'],
    parse: parsePrefixes,
  },

  // Proxies whose client address header is trusted, for the proxy plugin.
  // Both always publish IPv4 and IPv6 ranges.
  {
    name: 'cloudflare-ips',
    urls: [
      'https://www.cloudflare.com/ips-v4/',
      'https://www.cloudflare.com/ips-v6/',
    ],
    parse: parseLines,
    bothFamilies: true,
  },
  {
    name: 'cloudfront-ips',
    urls: ['https://ip-ranges.amazonaws.com/ip-ranges.json'],
    parse: parseAwsService('CLOUDFRONT'),
    bothFamilies: true,
  },
];

// whois://<host>/<query>
function whois(url) {
  const { hostname, pathname } = new URL(url);
  const request = decodeURIComponent(pathname.slice(1));
  return new Promise((resolve, reject) => {
    let response = '';
    const socket = net.connect(43, hostname, () =>
      socket.end(`${request}\r\n`)
    );
    socket.setEncoding('utf8');
    socket.setTimeout(30000, () =>
      socket.destroy(new Error(`${hostname}: timed out`))
    );
    socket.on('data', (chunk) => (response += chunk));
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
}

// The text at a URL (https or whois)
async function fetchText(url, { headers } = {}) {
  if (url.startsWith('whois://')) {
    return whois(url);
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// A source's list, checked; throws when it can't be fetched, is empty or has
// an invalid entry
async function build(source, { fetch = fetchText } = {}) {
  const values = [];
  for (const url of source.urls) {
    values.push(...source.parse(await fetch(url, source)));
  }
  const cidrs = [...new Set(values.map(toCidr))];
  if (cidrs.length === 0) {
    throw new Error('empty list');
  }
  // Throws on anything that isn't an address or a range
  compileRanges(cidrs);
  if (source.bothFamilies) {
    const ipv6 = cidrs.filter((cidr) => cidr.includes(':')).length;
    if (ipv6 === 0 || ipv6 === cidrs.length) {
      throw new Error('IPv4 or IPv6 ranges missing');
    }
  }
  return cidrs;
}

// Fetches each source and writes it; returns the names of those that failed,
// whose files were kept
async function refresh(list, { fetch, write, log = console.log } = {}) {
  const failed = [];
  for (const source of list) {
    try {
      const cidrs = await build(source, { fetch });
      write(source.name, cidrs);
      log(`${source.name}: ${cidrs.length} CIDRs`);
    } catch (error) {
      log(`${source.name}: failed, keeping current file: ${error.message}`);
      failed.push(source.name);
    }
  }
  return failed;
}

module.exports = {
  build,
  parseAwsService,
  parseData,
  parseKeys,
  parseLines,
  parsePrefixes,
  parseResults,
  parseRoutes,
  parseTableRow,
  refresh,
  removeNested,
  sources,
  toCidr,
};
