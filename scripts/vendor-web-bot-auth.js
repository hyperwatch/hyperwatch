// Builds Cloudflare's web-bot-auth packages at a commit of
// https://github.com/cloudflare/web-bot-auth and copies their CommonJS builds
// into src/vendor/web-bot-auth/, until the version Hyperwatch needs is
// published on npm (see src/vendor/web-bot-auth/README.md).
//
//   node scripts/vendor-web-bot-auth.js <commit>
//
// Needs git and npm. The repository is cloned and built in a temporary
// directory, which is removed afterwards.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repository = 'https://github.com/cloudflare/web-bot-auth.git';
const vendorDir = path.join(__dirname, '..', 'src', 'vendor', 'web-bot-auth');

// Built file → vendored file, with its type declarations (.d.cts) next to
// it. Requires and imports between them become relative.
const files = [
  ['packages/web-bot-auth/dist/index.cjs', 'index.cjs'],
  ['packages/web-bot-auth/dist/crypto.cjs', 'crypto.cjs'],
  ['packages/http-message-sig/dist/index.cjs', 'http-message-sig.cjs'],
  [
    'packages/jsonwebkey-thumbprint/dist/index.cjs',
    'jsonwebkey-thumbprint.cjs',
  ],
];
const requires = {
  'http-message-sig': './http-message-sig.cjs',
  'jsonwebkey-thumbprint': './jsonwebkey-thumbprint.cjs',
};

// Hyperwatch's changes to the built files, applied after the requires are
// rewritten (see src/vendor/web-bot-auth/README.md). Each `find` must occur
// exactly once, or the script stops: check the patch against the new commit.
const patches = {
  'index.cjs': [
    {
      // Some robots (Babbar's) send their legacy Signature-Agent as a bare
      // URL instead of a structured-field string: https://ibou.io rather than
      // "https://ibou.io". Accept it as that string. The signature still
      // covers the header as sent.
      find: '\t\ttry {\n\t\t\tconst [uri, params] = (0, structured_headers.parseItem)(header);',
      replace:
        '\t\tif (/^https:\\/\\/[^\\s"(),;<>\\\\]+$/.test(header)) try {\n' +
        '\t\t\tvalidateDiscoveryURI(header);\n' +
        '\t\t\treturn {\n' +
        '\t\t\t\tkind: "legacy",\n' +
        '\t\t\t\tentries: [{\n' +
        '\t\t\t\t\tlabel: "",\n' +
        '\t\t\t\t\turi: header\n' +
        '\t\t\t\t}]\n' +
        '\t\t\t};\n' +
        '\t\t} catch {}\n' +
        '\t\ttry {\n\t\t\tconst [uri, params] = (0, structured_headers.parseItem)(header);',
    },
  ],
};

function applyPatches(name, code) {
  for (const { find, replace } of patches[name] || []) {
    const count = code.split(find).length - 1;
    if (count !== 1) {
      throw new Error(`Patch for ${name} found ${count} times instead of once`);
    }
    code = code.replace(find, () => replace);
  }
  return code;
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
    .toString()
    .trim();
}

function main() {
  const commit = process.argv[2];
  if (!/^[0-9a-f]{7,40}$/.test(commit || '')) {
    console.error('Usage: node scripts/vendor-web-bot-auth.js <commit>');
    process.exitCode = 1;
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bot-auth-'));
  try {
    const repo = path.join(tmp, 'repo');
    run('git', ['clone', '--quiet', repository, repo]);
    run('git', ['checkout', '--quiet', commit], repo);
    const sha = run('git', ['rev-parse', 'HEAD'], repo);
    const date = run('git', ['show', '-s', '--format=%cs', 'HEAD'], repo);
    // No install scripts: only the build below runs
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], repo);
    run(
      'npm',
      [
        'run',
        'build',
        '-w',
        'http-message-sig',
        '-w',
        'jsonwebkey-thumbprint',
        '-w',
        'web-bot-auth',
      ],
      repo
    );

    // Everything but the README, which is written by hand
    fs.mkdirSync(vendorDir, { recursive: true });
    for (const name of fs.readdirSync(vendorDir)) {
      if (name !== 'README.md') {
        fs.rmSync(path.join(vendorDir, name), { recursive: true, force: true });
      }
    }
    // web-bot-auth's declarations share a chunk (index-<hash>.d.cts)
    const chunks = fs
      .readdirSync(path.join(repo, 'packages/web-bot-auth/dist'))
      .filter((name) => /^index-[\w-]+\.d\.cts$/.test(name))
      .map((name) => [`packages/web-bot-auth/dist/${name}`, name]);
    const declarations = files.map(([from, to]) => [
      from.replace(/\.cjs$/, '.d.cts'),
      to.replace(/\.cjs$/, '.d.cts'),
    ]);
    for (const [from, to] of [...files, ...declarations, ...chunks]) {
      let code = fs.readFileSync(path.join(repo, from), 'utf8');
      for (const [name, relative] of Object.entries(requires)) {
        code = code
          .split(`require("${name}")`)
          .join(`require("${relative}")`)
          .split(`from "${name}"`)
          .join(`from "${relative}"`);
      }
      fs.writeFileSync(path.join(vendorDir, to), applyPatches(to, code));
    }
    fs.copyFileSync(
      path.join(repo, 'LICENSE'),
      path.join(vendorDir, 'LICENSE')
    );
    const versions = Object.fromEntries(
      ['web-bot-auth', 'http-message-sig', 'jsonwebkey-thumbprint'].map(
        (name) => [
          name,
          JSON.parse(
            fs.readFileSync(
              path.join(repo, 'packages', name, 'package.json'),
              'utf8'
            )
          ).version,
        ]
      )
    );
    fs.writeFileSync(
      path.join(vendorDir, 'source.json'),
      `${JSON.stringify({ repository, commit: sha, date, versions }, null, 2)}\n`
    );
    console.log(`Vendored ${sha} (${date})`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
