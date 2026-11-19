/**
 * What scripts/release.js computes, without running anything: see
 * RELEASING.md.
 */

const REPOSITORY = 'https://github.com/hyperwatch/hyperwatch';

// Files npm adds to every package, whatever `files` says
const ALWAYS_PACKED = ['package.json', 'README.md', 'LICENSE', 'hyperwatch.js'];

/**
 * The packed files that `files` in package.json doesn't allow
 * @param {string[]} paths The paths of `npm pack --dry-run --json`
 * @param {string[]} files The `files` whitelist of package.json
 * @param {string} main The package's main file
 */
function unexpectedFiles(paths, files, main) {
  const allowed = new Set([...files, ...ALWAYS_PACKED, main]);
  return paths.filter((path) => !allowed.has(path.split('/')[0]));
}

/**
 * A commit subject as a line of the release notes, its PR linked in full
 * ("Fix x (#12)" → "- Fix x ([#12](…/pull/12))")
 * @param {string} subject
 */
function noteLine(subject) {
  const match = /^(.*?)\s*\(#(\d+)\)$/.exec(subject);
  return match
    ? `- ${match[1]} ([#${match[2]}](${REPOSITORY}/pull/${match[2]}))`
    : `- ${subject}`;
}

// A dependabot subject, either form: "Bump x from 1 to 2 (#3)",
// "build(deps-dev): bump x from 1 to 2 in /dir (#3)"
const BUMP =
  /^(?:build\(deps(?:-dev)?\): )?[Bb]ump (\S+) from \S+ to (\S+?)(?: in \S+)?(?: \(#(\d+)\))?$/;

/**
 * A draft of the release notes from the commits since the last release
 * (`git log --no-merges --format=%s`, newest first): version commits left
 * out, dependabot bumps in one line under "Dependencies &
 * tooling", the refreshes of the published lists under "Identities", the
 * rest to sort by hand.
 * @param {string[]} subjects
 */
function draftNotes(subjects) {
  const toSort = [];
  const identities = [];
  const bumps = new Map();
  const bumpPrs = [];
  for (const subject of subjects) {
    if (/^version \d+\.\d+\.\d+/.test(subject)) {
      continue;
    }
    const bump = BUMP.exec(subject);
    if (bump) {
      // The latest version of each package: the newest commit comes first
      if (!bumps.has(bump[1])) {
        bumps.set(bump[1], bump[2]);
      }
      if (bump[3]) {
        bumpPrs.push(bump[3]);
      }
    } else if (/^Refresh the published/.test(subject)) {
      identities.push(noteLine(subject));
    } else {
      toSort.push(noteLine(subject));
    }
  }
  const sections = [];
  if (toSort.length) {
    const heading =
      '### To sort: Breaking changes, Features, Fixes, Identities';
    sections.push(`${heading}\n\n${toSort.join('\n')}`);
  }
  if (identities.length) {
    sections.push(`### Identities\n\n${identities.join('\n')}`);
  }
  if (bumps.size) {
    const packages = [...bumps]
      .map(([name, version]) => `\`${name}\` (${version})`)
      .join(', ');
    const links = bumpPrs
      .sort((a, b) => Number(a) - Number(b))
      .map((pr) => `[#${pr}](${REPOSITORY}/pull/${pr})`)
      .join(', ');
    sections.push(
      `### Dependencies & tooling\n\n- Dependabot bumps of ${packages}.${
        links ? ` (${links})` : ''
      }`
    );
  }
  return sections.join('\n\n');
}

/**
 * The notes of one version in CHANGELOG.md, without their `## X.Y.Z`
 * heading: what the GitHub release gets
 * @param {string} changelog
 * @param {string} version
 */
function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const escaped = version.replace(/\./g, '\\.');
  const start = lines.findIndex((line) =>
    new RegExp(`^## ${escaped}(\\s|$)`).test(line)
  );
  if (start === -1) {
    return null;
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('## ')
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

module.exports = {
  changelogSection,
  draftNotes,
  noteLine,
  unexpectedFiles,
};
