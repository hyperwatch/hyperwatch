// Refreshes the keys of the Web Bot Auth agents Hyperwatch knows
// (src/data/web-bot-auth-agents.json) from their key directories, into
// src/data/web-bot-auth-keys.json: all of them or those named.
//
//   node scripts/fetch-web-bot-auth-keys.js
//   node scripts/fetch-web-bot-auth-keys.js https://crawler.exa.ai
//
// The web-bot-auth module starts with these keys, then fetches the
// directories itself (modules.webBotAuth.fetch). An agent whose directory
// can't be fetched keeps its current keys, and the script exits with status 1.
const fs = require('fs');
const path = require('path');

const { fetchDirectory } = require('../src/lib/web-bot-auth');

const dataDir = path.join(__dirname, '..', 'src', 'data');
const agentsFile = path.join(dataDir, 'web-bot-auth-agents.json');
const keysFile = path.join(dataDir, 'web-bot-auth-keys.json');

async function main() {
  const agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8')).map(
    (entry) => entry.agent
  );
  const names = process.argv.slice(2);
  const unknown = names.filter((name) => !agents.includes(name));
  if (unknown.length > 0) {
    console.error(`Unknown agents: ${unknown.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const current = fs.existsSync(keysFile)
    ? JSON.parse(fs.readFileSync(keysFile, 'utf8'))
    : {};
  const keys = {};
  const failed = [];
  for (const agent of agents) {
    if (names.length > 0 && !names.includes(agent)) {
      if (current[agent]) {
        keys[agent] = current[agent];
      }
      continue;
    }
    try {
      const { jwks } = await fetchDirectory(agent);
      keys[agent] = jwks;
      console.log(`${agent}: ${jwks.length} keys`);
    } catch (error) {
      console.log(`${agent}: failed, keeping current keys: ${error.message}`);
      failed.push(agent);
      if (current[agent]) {
        keys[agent] = current[agent];
      }
    }
  }
  fs.writeFileSync(keysFile, `${JSON.stringify(keys, null, 2)}\n`);
  if (failed.length > 0) {
    console.error(`Failed: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
}

main();
