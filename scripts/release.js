// Helps with the steps of RELEASING.md that need no decision. Run it from
// the release worktree (step 1).
//
//   node scripts/release.js check     Steps 2–3: the tree is origin/main,
//                                     unchanged; every check passes; the
//                                     package holds only what `files` allows
//   node scripts/release.js changes   Step 4: the last release, and a draft
//                                     of the notes from the commits since
//   node scripts/release.js notes X.Y.Z [file]
//                                     Step 8: the CHANGELOG.md section of
//                                     X.Y.Z, for the GitHub release
//
// It never commits, tags, pushes or publishes.
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const {
  changelogSection,
  draftNotes,
  unexpectedFiles,
} = require('./lib/release');

const root = path.join(__dirname, '..');

const git = (...args) =>
  execFileSync('git', args, { cwd: root }).toString().trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The latest release tag reachable from origin/main
function lastTag() {
  return git(
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    'v*',
    'origin/main'
  );
}

function check() {
  git('fetch', '--quiet', 'origin');
  const problems = [];
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
    problems.push('HEAD is not origin/main: only origin/main ships');
  }
  if (git('status', '--porcelain')) {
    problems.push('the working tree has changes');
  }
  for (const script of [
    'test',
    'lint',
    'prettier:check',
    'type:check',
    'types:test',
    'depcheck',
  ]) {
    console.log(`> npm run ${script}`);
    // The output only when it fails
    const { status, stdout, stderr } = spawnSync(
      'npm',
      ['run', '--silent', script],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    if (status === 0) {
      console.log('  passed');
    } else {
      console.log('  FAILED');
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      problems.push(`npm run ${script} failed`);
    }
  }
  console.log('> npm pack --dry-run');
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--silent'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
  );
  const paths = packed.files.map((file) => file.path);
  const unexpected = unexpectedFiles(paths, pkg.files, pkg.main);
  console.log(
    `  ${paths.length} files, ${(packed.size / 1024).toFixed(0)} kB packed`
  );
  if (unexpected.length) {
    problems.push(`unexpected files in the package: ${unexpected.join(', ')}`);
  }
  if (problems.length) {
    fail(`\nStop, fix on main first:\n- ${problems.join('\n- ')}`);
  }
  console.log('\nEverything passed.');
}

function changes() {
  git('fetch', '--quiet', '--tags', 'origin');
  const tag = lastTag();
  let published = null;
  try {
    published = execFileSync('npm', ['view', pkg.name, 'version'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch (err) {
    // Offline: only the tag
  }
  console.log(`Last release: ${tag}, on npm: ${published || 'unknown'}`);
  if (published && `v${published}` !== tag) {
    console.log(
      `Warning: the last tag isn't the published version: check which commits shipped (npm pack ${pkg.name}@${published})`
    );
  }
  const commits = git(
    'log',
    '--no-merges',
    '--format=%s',
    `${tag}..origin/main`
  )
    .split('\n')
    .filter(Boolean);
  if (commits.length === 0) {
    console.log('Nothing to release.');
    return;
  }
  console.log(`${commits.length} commits since ${tag}. Draft:\n`);
  console.log(draftNotes(commits));
}

function notes(version, file) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    fail('Usage: node scripts/release.js notes X.Y.Z [file]');
  }
  const section = changelogSection(
    fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
    version
  );
  if (!section) {
    fail(`No "## ${version}" section in CHANGELOG.md`);
  }
  if (file) {
    fs.writeFileSync(file, `${section}\n`);
    console.log(`Written to ${file}`);
  } else {
    console.log(section);
  }
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case 'check':
    check();
    break;
  case 'changes':
    changes();
    break;
  case 'notes':
    notes(args[0], args[1]);
    break;
  default:
    fail('Usage: node scripts/release.js check | changes | notes X.Y.Z [file]');
}
