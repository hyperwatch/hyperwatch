const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'src', 'data');

// GitHub publishes its address ranges per service at
// https://api.github.com/meta (https://docs.github.com/en/rest/meta/meta).
//
// github-ips: the ranges GitHub runs its own services from (web, API,
// webhooks, git, Pages, Packages, importers, Copilot), where github-camo, the
// image proxy behind README badges, comes from. The `actions` ranges are left
// out: Actions runners there run any GitHub user's workflows.
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
