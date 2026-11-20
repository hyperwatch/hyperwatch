const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CATEGORIES,
  build,
  parseRobot,
  report,
  scanIdentities,
} = require('../../scripts/lib/robot-categories');
const data = require('../../src/data/robot-categories.json');
const { lookup } = require('../../src/lib/robot-category');

const root = path.join(__dirname, '..', '..');

const robot = (name, category, family, identity) => ({
  file: `${name}.md`,
  category,
  family,
  identity,
});

// A robot file. `omit` leaves fields out of the front matter.
const file = (
  { category = 'seo', family = 'ExampleBot', identity = 'Example' } = {},
  omit = []
) =>
  [
    '---',
    'name: ExampleBot',
    'operator: Example Inc.',
    ...(omit.includes('category') ? [] : [`category: ${category}`]),
    'verification:',
    '  method: ip-list',
    '  hostnames: []',
    ...(omit.includes('hyperwatch') ? [] : ['hyperwatch:']),
    ...(omit.includes('family') ? [] : [`  family: ${family}`]),
    ...(omit.includes('identity') ? [] : [`  identity: ${identity}`]),
    'last_checked: 2026-10-15',
    '---',
    '',
    '# ExampleBot',
    '',
    'category: not this one',
    '',
  ].join('\n');

describe('robot categories', () => {
  describe('parseRobot', () => {
    it('reads the category, the family and the identity', () => {
      assert.deepStrictEqual(parseRobot(file({}), 'examplebot.md'), {
        file: 'examplebot.md',
        category: 'seo',
        family: 'ExampleBot',
        identity: 'Example',
      });
    });

    it('reads values with spaces, quotes and null', () => {
      assert.deepStrictEqual(
        parseRobot(
          file({ family: 'Coc Coc Bot Web', identity: '"Coc Coc"' }),
          'a.md'
        ),
        {
          file: 'a.md',
          category: 'seo',
          family: 'Coc Coc Bot Web',
          identity: 'Coc Coc',
        }
      );
      const none = parseRobot(file({ family: 'null', identity: '~' }), 'a.md');
      assert.strictEqual(none.family, null);
      assert.strictEqual(none.identity, null);
    });

    it('rejects a file without front matter or without a field', () => {
      assert.throws(
        () => parseRobot('# ExampleBot\n', 'a.md'),
        /a\.md: no front matter/
      );
      for (const field of ['category', 'hyperwatch', 'family', 'identity']) {
        assert.throws(
          () => parseRobot(file({}, [field]), 'a.md'),
          new RegExp(`a\\.md: no ${field}`)
        );
      }
      assert.throws(
        () => parseRobot(file({ category: '' }), 'a.md'),
        /empty category/
      );
    });

    it('does not read the keys of other blocks', () => {
      const text = file({}, ['family']).replace(
        '  hostnames: []',
        '  hostnames: []\n  family: NotThisOne'
      );
      assert.throws(() => parseRobot(text, 'a.md'), /no family/);
    });
  });

  describe('build', () => {
    it('gives one category to an identity whose robots agree', () => {
      assert.deepStrictEqual(
        build([
          robot('googlebot', 'search-engine', 'Googlebot', 'Googlebot'),
          robot('pingdom', 'monitoring', 'PingdomBot', 'Pingdom'),
          // No family: still one category
          robot('yisou', 'unknown', null, 'Shenma'),
        ]),
        {
          Googlebot: 'search-engine',
          Pingdom: 'monitoring',
          Shenma: 'unknown',
        }
      );
    });

    it('gives a category per family to an identity whose robots differ', () => {
      assert.deepStrictEqual(
        build([
          robot('yepbot', 'search-engine', 'YepBot', 'Ahrefs'),
          robot('ahrefsbot', 'seo', 'AhrefsBot', 'Ahrefs'),
          robot('ahrefssiteaudit', 'seo', 'AhrefsSiteAudit', 'Ahrefs'),
        ]),
        {
          Ahrefs: {
            AhrefsBot: 'seo',
            AhrefsSiteAudit: 'seo',
            YepBot: 'search-engine',
          },
        }
      );
    });

    it('counts a robot without family when comparing, without a key for it', () => {
      assert.deepStrictEqual(
        build([
          robot('slurp', 'search-engine', 'Yahoo! Slurp', 'Yahoo'),
          robot('mailproxy', 'other', null, 'Yahoo'),
        ]),
        { Yahoo: { 'Yahoo! Slurp': 'search-engine' } }
      );
    });

    it('leaves out robots without identity', () => {
      assert.deepStrictEqual(
        build([robot('unverified', 'seo', 'SomeBot', null)]),
        {}
      );
    });

    it('accepts a family under several identities', () => {
      // Signed robots use browser families
      assert.deepStrictEqual(
        build([
          robot('chatgpt-agent', 'ai-assistant', 'Chrome', 'ChatGPT Agent'),
          robot('other-agent', 'other', 'Chrome', 'Other Agent'),
        ]),
        { 'ChatGPT Agent': 'ai-assistant', 'Other Agent': 'other' }
      );
    });

    it('rejects two categories for one family of an identity', () => {
      assert.throws(
        () =>
          build([
            robot('a', 'seo', 'ExampleBot', 'Example'),
            robot('b', 'search-engine', 'ExampleBot', 'Example'),
          ]),
        /Example: the family ExampleBot is seo in a\.md and search-engine in b\.md/
      );
    });

    it('rejects a category it does not know, even without identity', () => {
      assert.throws(
        () => build([robot('a', 'scanner', 'ExampleBot', null)]),
        /a\.md: unknown category "scanner"/
      );
    });

    it('sorts identities and families', () => {
      const categories = build([
        robot('b', 'seo', 'B', 'Zed'),
        robot('a', 'other', 'A', 'Zed'),
        robot('c', 'seo', 'C', 'Alpha'),
      ]);
      assert.deepStrictEqual(Object.keys(categories), ['Alpha', 'Zed']);
      assert.deepStrictEqual(Object.keys(categories.Zed), ['A', 'B']);
    });
  });

  describe('scanIdentities', () => {
    const source = fs.readFileSync(
      path.join(root, 'src', 'modules', 'identity.js'),
      'utf8'
    );
    const scan = scanIdentities(source);
    const has = (family, identity) =>
      scan.pairs.some(([f, i]) => f === family && i === identity);

    it('reads every rule of src/modules/identity.js', () => {
      // A rule written in a new way: teach scanIdentities() to read it
      assert.deepStrictEqual(scan.unknown, []);
    });

    it('finds the identity of each family', () => {
      assert.ok(has('YepBot', 'Ahrefs'));
      assert.ok(has('Googlebot-Image', 'Googlebot'));
      // Several labels, a rule ending with `break`
      assert.ok(has('SiteAuditBot', 'Semrush'));
      assert.ok(has('SemrushBot', 'Semrush'));
      // The identity is the family
      assert.ok(has('Applebot', 'Applebot'));
      assert.ok(has('Shields.io', 'Shields.io'));
      // Google's pools
      assert.ok(has('GoogleImageProxy', 'Google Proxy'));
      assert.ok(has('GoogleImageProxy', 'Google Special Crawlers'));
      // Not the labels of the rule before
      assert.ok(!has('AhrefsBot', 'Pinterest'));
      assert.ok(!has('Applebot', 'Googlebot'));
    });

    it('finds the identities set whatever the family', () => {
      for (const identity of [
        'ChatGPT Agent', // signed only
        'Stripe', // hostname only, from the table
        'Shenma', // hostname only, written out
        'Google Agent', // Google's pools
        'Majestic', // signature
      ]) {
        assert.ok(scan.anyFamily.includes(identity), identity);
      }
      assert.ok(!scan.anyFamily.includes('Pingdom'));
    });

    it('reports a rule it cannot read', () => {
      const changed = source.replace(
        "log.set('identity', 'Pingdom')",
        "log.set('identity', pingdomName)"
      );
      assert.notStrictEqual(changed, source);
      assert.deepStrictEqual(scanIdentities(changed).unknown, [
        ".set('identity', pingdomName)",
      ]);
    });

    it('reports a table it cannot find', () => {
      const changed = source.replace(
        'const signedOnly = new Map([',
        'const signed = new Map(['
      );
      assert.match(scanIdentities(changed).unknown.join('\n'), /"signer"/);
    });
  });

  describe('report', () => {
    const scan = {
      pairs: [
        ['AhrefsBot', 'Ahrefs'],
        ['YepBot', 'Ahrefs'],
        ['AhrefsNewBot', 'Ahrefs'],
        ['PingdomBot', 'Pingdom'],
        ['PayPal', 'PayPal'],
      ],
      anyFamily: ['Exa'],
      unknown: [],
    };
    const categories = {
      Ahrefs: { AhrefsBot: 'seo', YepBot: 'search-engine' },
      Exa: { ExaUser: 'ai-assistant', ExaSearchBot: 'ai-search' },
      Gone: 'seo',
      Pingdom: 'monitoring',
    };

    it('lists what has no category, and what changed', () => {
      const text = report(categories, scan, {
        Ahrefs: 'seo',
        Pingdom: 'monitoring',
        Removed: 'other',
      }).join('\n');
      assert.match(text, /Identities without a category \(1\).*\n {2}PayPal\n/);
      assert.match(
        text,
        /several categories \(1\):\n {2}Ahrefs: AhrefsNewBot\n/
      );
      assert.match(text, /whatever the agent family \(1\).*\n {2}Exa\n/);
      assert.match(text, /doesn't set \(1\):\n {2}Gone\n/);
      assert.match(text, /Changes since the committed file \(4\):/);
      assert.match(
        text,
        / {2}Ahrefs: seo -> per family \(AhrefsBot: seo, YepBot: search-engine\)/
      );
      assert.match(text, / {2}Removed: other -> none/);
      assert.match(text, / {2}Gone: none -> seo/);
      assert.doesNotMatch(text, / {2}Pingdom: /);
    });
  });

  // The committed file, against the rules it is used with
  describe('src/data/robot-categories.json', () => {
    const scan = scanIdentities(
      fs.readFileSync(path.join(root, 'src', 'modules', 'identity.js'), 'utf8')
    );
    const identities = new Set([
      ...scan.pairs.map(([, identity]) => identity),
      ...scan.anyFamily,
    ]);

    it('names the database commit it was built from', () => {
      assert.match(data.database, /^[0-9a-f]{40}$/);
    });

    it('only has identities that src/modules/identity.js sets', () => {
      // An identity renamed or removed: run scripts/robot-categories.js again
      // once the database follows
      assert.deepStrictEqual(
        Object.keys(data.identities).filter((id) => !identities.has(id)),
        []
      );
    });

    it('only has known categories', () => {
      for (const [identity, entry] of Object.entries(data.identities)) {
        for (const category of typeof entry === 'string'
          ? [entry]
          : Object.values(entry)) {
          assert.ok(CATEGORIES.includes(category), `${identity}: ${category}`);
        }
        if (typeof entry !== 'string') {
          // Per family only when the robots of the identity differ
          assert.ok(Object.keys(entry).length > 0, identity);
        }
      }
    });

    it('gives a category to most identities', () => {
      const without = [...identities].filter(
        (id) => !Object.hasOwn(data.identities, id)
      );
      // Notifications (PayPal, Wise) and identities without robot file
      assert.ok(without.length < identities.size / 10, without.join(', '));
      assert.strictEqual(
        lookup(data.identities, 'Googlebot', 'Chrome'),
        'search-engine'
      );
    });
  });
});
