const assert = require('assert');

const {
  addChangelogSection,
  changelogSection,
  draftNotes,
  isAbove,
  noteLine,
  notesProblem,
  unexpectedFiles,
} = require('../../scripts/lib/release');

const pull = (number) =>
  `[#${number}](https://github.com/hyperwatch/hyperwatch/pull/${number})`;

describe('release', () => {
  describe('unexpectedFiles', () => {
    it('allows the files whitelist and what npm always adds', () => {
      const paths = [
        'package.json',
        'README.md',
        'LICENSE',
        'hyperwatch.js',
        'src/index.js',
        'types/hyperwatch.d.ts',
        'scripts/fetch-ips.js',
        '.env',
      ];
      assert.deepStrictEqual(
        unexpectedFiles(paths, ['src', 'types'], 'hyperwatch.js'),
        ['scripts/fetch-ips.js', '.env']
      );
    });
  });

  describe('noteLine', () => {
    it('links the PR in full', () => {
      assert.strictEqual(
        noteLine('identity: Meta Agent (#753)'),
        `- identity: Meta Agent (${pull(753)})`
      );
      assert.strictEqual(noteLine('A direct commit'), '- A direct commit');
    });
  });

  describe('draftNotes', () => {
    it('sorts what it can, and leaves the rest to sort', () => {
      const notes = draftNotes([
        'geoip: the country by default (#749)',
        'build(deps): bump immutable from 5.1.10 to 5.2.1 (#743)',
        'Refresh the published IP ranges (#740)',
        'version 5.7.0',
        'Bump ws from 8.22.0 to 8.23.0 (#744)',
        'build(deps-dev): bump eslint from 10.14.0 to 10.15.0 in /docs (#750)',
        'build(deps): bump immutable from 5.1.9 to 5.1.10 (#729)',
      ]);
      assert.strictEqual(
        notes,
        [
          '### To sort: Breaking changes, Features, Fixes, Identities',
          '',
          `- geoip: the country by default (${pull(749)})`,
          '',
          '### Identities',
          '',
          `- Refresh the published IP ranges (${pull(740)})`,
          '',
          '### Dependencies & tooling',
          '',
          `- Dependabot bumps of \`immutable\` (5.2.1), \`ws\` (8.23.0), \`eslint\` (10.15.0). (${[
            729, 743, 744, 750,
          ]
            .map(pull)
            .join(', ')})`,
        ].join('\n')
      );
    });

    it('is empty without changes', () => {
      assert.strictEqual(draftNotes(['version 5.7.0']), '');
    });
  });

  describe('changelogSection', () => {
    const changelog = [
      '# Changelog',
      '',
      '## 5.7.0 (2026-11-14)',
      '',
      '### Features',
      '',
      '- One',
      '',
      '## 5.6.0 (2026-11-12)',
      '',
      '- Two',
      '',
    ].join('\n');

    it('gives the notes of one version, without its heading', () => {
      assert.strictEqual(
        changelogSection(changelog, '5.7.0'),
        '### Features\n\n- One'
      );
      assert.strictEqual(changelogSection(changelog, '5.6.0'), '- Two');
    });

    it('matches the whole version', () => {
      assert.strictEqual(changelogSection(changelog, '5.7'), null);
      assert.strictEqual(changelogSection(changelog, '5.6.1'), null);
    });
  });

  describe('addChangelogSection', () => {
    const changelog =
      '# Changelog\n\nIntro.\n\n## 5.7.0 (2026-11-14)\n\n- One\n';

    it('adds the section above the latest one', () => {
      assert.strictEqual(
        addChangelogSection(changelog, '5.8.0', '2026-11-20', '- Two'),
        '# Changelog\n\nIntro.\n\n## 5.8.0 (2026-11-20)\n\n- Two\n\n## 5.7.0 (2026-11-14)\n\n- One\n'
      );
    });

    it('refuses a version it already has', () => {
      assert.throws(
        () => addChangelogSection(changelog, '5.7.0', '2026-11-20', '- Two'),
        /already has a 5\.7\.0 section/
      );
    });
  });

  describe('isAbove', () => {
    it('compares each number', () => {
      assert.ok(isAbove('5.8.0', '5.7.0'));
      assert.ok(isAbove('5.10.0', '5.9.3'));
      assert.ok(isAbove('6.0.0', '5.99.99'));
      assert.ok(!isAbove('5.7.0', '5.7.0'));
      assert.ok(!isAbove('5.6.9', '5.7.0'));
    });
  });

  describe('notesProblem', () => {
    const changelog = (notes) =>
      `# Changelog\n\n## 5.8.0 (2026-11-20)\n\n${notes}\n`;

    it('accepts sorted notes', () => {
      assert.strictEqual(
        notesProblem(changelog('### Fixes\n\n- One'), '5.8.0'),
        null
      );
    });

    it('refuses missing, empty or unsorted notes', () => {
      assert.match(
        notesProblem(changelog('- One'), '5.9.0'),
        /no "## 5\.9\.0"/
      );
      assert.match(notesProblem(changelog('- …'), '5.8.0'), /empty/);
      assert.match(
        notesProblem(changelog('### To sort: Features\n\n- One'), '5.8.0'),
        /To sort/
      );
    });
  });
});
