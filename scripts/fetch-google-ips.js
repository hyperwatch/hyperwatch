const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// Google publishes the ranges of its crawlers and fetchers at
// https://developers.google.com/crawling/docs/crawlers-fetchers/overview-google-crawlers.
//
// google-user-triggered-fetchers-ips: the fetchers acting on a user's
// request, shared by every user. Google Apps Script (UrlFetchApp) fetches from
// them, e.g. 34.116.28.0/27.
const sources = [
  {
    name: 'google-user-triggered-fetchers-ips',
    url: 'https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json',
  },
];

async function fetchAndStore({ name, url }) {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Failed to fetch ${name}: ${res.status} ${res.statusText}`);
    process.exitCode = 1;
    return;
  }
  const { prefixes } = await res.json();
  const cidrs = (prefixes || [])
    .map((prefix) => prefix.ipv4Prefix || prefix.ipv6Prefix)
    .filter(Boolean);
  if (cidrs.length === 0) {
    console.error(`Failed to build ${name}: empty list, keeping current file`);
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
