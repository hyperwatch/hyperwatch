// Refreshes src/data/robot-categories.json, the category of each identity's
// robots, from a checkout of the robots database
// (https://github.com/hyperwatch/database):
//
//   node scripts/robot-categories.js ../database
//
// The checkout must be clean under robots/, so that the commit written in the
// file says what it was built from. Prints what has no category and what
// changed since the committed file: read it before a release. The file keeps
// its current content, and the script exits with status 1, when a robot file
// can't be read, has a category the script doesn't know, or two files give one
// agent family of an identity two categories.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  build,
  parseRobot,
  report,
  scanIdentities,
} = require('./lib/robot-categories');

const root = path.join(__dirname, '..');
const dataFile = path.join(root, 'src', 'data', 'robot-categories.json');

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', args, { cwd }).toString().trim();
}

function main() {
  const database = process.argv[2];
  if (!database) {
    console.error(
      'Usage: node scripts/robot-categories.js <database checkout>'
    );
    process.exitCode = 1;
    return;
  }
  const robotsDir = path.join(database, 'robots');
  const dirty = git(database, ['status', '--porcelain', '--', 'robots']);
  if (dirty) {
    throw new Error(
      `${robotsDir} has changes that aren't committed:\n${dirty}\nUse a clean checkout (git worktree add --detach <dir> origin/main).`
    );
  }
  const commit = git(database, ['rev-parse', 'HEAD']);

  const robots = fs
    .readdirSync(robotsDir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) =>
      parseRobot(fs.readFileSync(path.join(robotsDir, file), 'utf8'), file)
    );
  const categories = build(robots);

  const previous = fs.existsSync(dataFile)
    ? JSON.parse(fs.readFileSync(dataFile, 'utf8')).identities
    : {};
  const scan = scanIdentities(
    fs.readFileSync(path.join(root, 'src', 'modules', 'identity.js'), 'utf8')
  );
  if (scan.unknown.length > 0) {
    throw new Error(
      `scanIdentities() can't read these rules of src/modules/identity.js:\n${scan.unknown.join('\n')}`
    );
  }

  fs.writeFileSync(
    dataFile,
    `${JSON.stringify({ database: commit, identities: categories }, null, 2)}\n`
  );
  console.log(
    `${robots.length} robot files at ${commit.slice(0, 7)}, ${Object.keys(categories).length} identities with a category.\n`
  );
  console.log(report(categories, scan, previous).join('\n'));
}

try {
  main();
} catch (/** @type {any} */ err) {
  console.error(err.message);
  process.exitCode = 1;
}
