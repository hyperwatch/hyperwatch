// Refreshes the address lists operators publish (src/data/*-ips.json), all of
// them or those named:
//
//   node scripts/fetch-ips.js
//   node scripts/fetch-ips.js meta-ips claude-bot-ips
//
// Sources are in scripts/published-ips.json. A list that can't be fetched
// keeps its current file, and the script exits with status 1.
const fs = require('fs');
const path = require('path');

const { refresh, sources } = require('./lib/published-ips');

const dataDir = path.join(__dirname, '..', 'src', 'data');

async function main() {
  const names = process.argv.slice(2);
  const unknown = names.filter((name) => !sources.some((s) => s.name === name));
  if (unknown.length > 0) {
    console.error(`Unknown lists: ${unknown.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const failed = await refresh(
    names.length > 0 ? sources.filter((s) => names.includes(s.name)) : sources,
    {
      write: (name, cidrs) =>
        fs.writeFileSync(
          path.join(dataDir, `${name}.json`),
          `${JSON.stringify(cidrs, null, 2)}\n`
        ),
    }
  );
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main();
