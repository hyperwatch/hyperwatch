const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// GitHub publishes its address ranges per service at
// https://api.github.com/meta (https://docs.github.com/en/rest/meta/meta).
//
// - github-ips: the ranges GitHub runs its own services from (web, API,
//   webhooks, git, Pages, Packages, importers, Copilot). github-camo, the
//   image proxy behind README badges, historically came from here.
// - github-actions-ips: the `actions` ranges. Since 2026 github-camo also
//   fetches from GitHub-owned space listed only there (9.234.0.0/17). The list
//   is large and mostly Azure address space shared with other Azure tenants,
//   so it is kept apart and only combined with an agent check.
const sources = [
  {
    name: 'github-ips',
    keys: [
      'hooks',
      'web',
      'api',
      'git',
      'pages',
      'packages',
      'importer',
      'github_enterprise_importer',
      'copilot',
    ],
  },
  { name: 'github-actions-ips', keys: ['actions'] },
];

function normalize(cidr) {
  if (cidr.includes('/')) {
    return cidr;
  }
  return cidr.includes(':') ? `${cidr}/128` : `${cidr}/32`;
}

function extractCidrs(meta, keys) {
  const cidrs = new Set();
  for (const key of keys) {
    const ranges = meta[key];
    if (!Array.isArray(ranges)) {
      throw new Error(`unexpected payload: no "${key}" array`);
    }
    for (const range of ranges) {
      if (typeof range === 'string') {
        cidrs.add(normalize(range));
      }
    }
  }
  return [...cidrs];
}

function store({ name, keys }, meta) {
  const cidrs = extractCidrs(meta, keys);
  if (cidrs.length === 0) {
    console.error(`Failed to build ${name}: empty list, keeping current file`);
    process.exitCode = 1;
    return;
  }
  const filePath = path.join(dataDir, `${name}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(cidrs, null, 2)}\n`);
  console.log(`${name}: ${cidrs.length} CIDRs (${keys.join(', ')})`);
}

async function main() {
  const res = await fetch('https://api.github.com/meta', {
    headers: { accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch GitHub meta: ${res.status} ${res.statusText}`
    );
  }
  const meta = await res.json();
  for (const source of sources) {
    store(source, meta);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
