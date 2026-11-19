// The steps of a release that need no decision, for the release workflows
// (.github/workflows/release-prepare.yml, release.yml) and by hand. See
// RELEASING.md.
//
//   node scripts/release.js changes        The last release, and a draft of
//                                          the notes from the commits since
//   node scripts/release.js prepare X.Y.Z  Bumps package.json and
//                                          package-lock.json, and adds the
//                                          drafted notes to CHANGELOG.md
//   node scripts/release.js verify         The notes of package.json's
//                                          version are ready to release
//   node scripts/release.js pack           The package holds only what
//                                          `files` allows
//   node scripts/release.js notes X.Y.Z [file]
//                                          The CHANGELOG.md section of
//                                          X.Y.Z, for the GitHub release
//
// It never commits, tags, pushes or publishes.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  addChangelogSection,
  changelogSection,
  draftNotes,
  isAbove,
  notesProblem,
  unexpectedFiles,
} = require('./lib/release');

const root = path.join(__dirname, '..');
const changelogPath = path.join(root, 'CHANGELOG.md');

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
const git = (...args) => run('git', args);
// Read when needed: `prepare` changes it
const pkg = () => JSON.parse(fs.readFileSync(path.join(root, 'package.json')));

function fail(message) {
  console.error(message);
  process.exit(1);
}

// The latest release tag before HEAD
function lastTag() {
  return git('describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD');
}

// The notes drafted from the commits since the last release
function draft() {
  const tag = lastTag();
  const subjects = git('log', '--no-merges', '--format=%s', `${tag}..HEAD`)
    .split('\n')
    .filter(Boolean);
  return { tag, subjects, notes: draftNotes(subjects) };
}

function changes() {
  const { tag, subjects, notes } = draft();
  let published = null;
  try {
    published = run('npm', ['view', pkg().name, 'version']);
  } catch (err) {
    // Offline: only the tag
  }
  console.log(`Last release: ${tag}, on npm: ${published || 'unknown'}`);
  if (published && `v${published}` !== tag) {
    console.log(
      `Warning: the last tag isn't the published version: check which commits shipped (npm pack ${pkg().name}@${published})`
    );
  }
  if (subjects.length === 0) {
    console.log('Nothing to release.');
    return;
  }
  console.log(`${subjects.length} commits since ${tag}. Draft:\n`);
  console.log(notes);
}

function prepare(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    fail('Usage: node scripts/release.js prepare X.Y.Z');
  }
  const current = pkg().version;
  if (!isAbove(version, current)) {
    fail(`${version} isn't above the current version, ${current}`);
  }
  const { notes } = draft();
  const date = new Date().toISOString().slice(0, 10);
  const changelog = addChangelogSection(
    fs.readFileSync(changelogPath, 'utf8'),
    version,
    date,
    notes
  );
  run('npm', ['version', version, '--no-git-tag-version']);
  fs.writeFileSync(changelogPath, changelog);
  console.log(`${current} → ${version}, notes drafted in CHANGELOG.md`);
}

function verify() {
  const { version } = pkg();
  const problem = notesProblem(fs.readFileSync(changelogPath, 'utf8'), version);
  if (problem) {
    fail(`Can't release ${version}: ${problem}`);
  }
  console.log(`The ${version} notes are ready`);
}

function pack() {
  const { files, main } = pkg();
  const [packed] = JSON.parse(run('npm', ['pack', '--dry-run', '--json']));
  const paths = packed.files.map((file) => file.path);
  const unexpected = unexpectedFiles(paths, files, main);
  if (unexpected.length) {
    fail(`Unexpected files in the package: ${unexpected.join(', ')}`);
  }
  console.log(
    `${paths.length} files, ${(packed.size / 1024).toFixed(0)} kB packed, all expected`
  );
}

function notes(version, file) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    fail('Usage: node scripts/release.js notes X.Y.Z [file]');
  }
  const section = changelogSection(
    fs.readFileSync(changelogPath, 'utf8'),
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
const commands = {
  changes,
  prepare: () => prepare(args[0]),
  verify,
  pack,
  notes: () => notes(args[0], args[1]),
};
if (!commands[command]) {
  fail(
    'Usage: node scripts/release.js changes | prepare X.Y.Z | verify | pack | notes X.Y.Z [file]'
  );
}
commands[command]();
