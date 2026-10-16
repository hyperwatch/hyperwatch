/**
 * The address lists operators publish, fetched into src/data/<name>.json by
 * scripts/fetch-ips.js. The sources are in scripts/published-ips.json: each
 * has one or more URLs and a `format`, the parser that reads the addresses
 * and ranges from the response's text.
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

// A parser for each `format` of scripts/published-ips.json, given the source
// for its options
const parsers = {
  awsService: ({ service }) => parseAwsService(service),
  data: () => parseData,
  keys: ({ keys }) => parseKeys(keys),
  lines: () => parseLines,
  prefixes: () => parsePrefixes,
  results: ({ service }) => parseResults(service),
  // Meta's routes in RADb
  routes: () => (text) => removeNested(parseRoutes(text)),
  tableRow: ({ label }) => parseTableRow(label),
};

// The sources in scripts/published-ips.json, each with its parser
function loadSources(list) {
  return list.map((source) => {
    if (!parsers[source.format]) {
      throw new Error(`${source.name}: unknown format "${source.format}"`);
    }
    return { ...source, parse: parsers[source.format](source) };
  });
}

const sources = loadSources(require('../published-ips.json'));

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
  loadSources,
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
