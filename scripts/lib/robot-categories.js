// Builds src/data/robot-categories.json from the robots database
// (https://github.com/hyperwatch/database): the category of each identity's
// robots. See scripts/robot-categories.js.
const { lookup } = require('../../src/lib/robot-category');

// The categories of the database. A category it adds stops the script, so that
// it enters a release knowingly: applications decide by category.
const CATEGORIES = [
  'ai-assistant',
  'ai-search',
  'ai-training',
  'archive',
  'marketing',
  'monitoring',
  'other',
  'research',
  'search-engine',
  'seo',
  'social-preview',
  'unknown',
];

/**
 * @typedef {object} Robot A robot file's front matter, as far as it is used
 * @property {string} file
 * @property {string} category
 * @property {string | null} family The agent family of its user agent
 * @property {string | null} identity The identity Hyperwatch gives it
 */

/** @typedef {import('../../src/lib/robot-category').Categories} Categories */

/**
 * A scalar of the front matter: `null` and `~` are null, quotes are removed.
 * @param {string} value
 * @returns {string | null}
 */
function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed === 'null' || trimmed === '~') {
    return null;
  }
  const quoted = trimmed.match(/^(["'])(.*)\1$/);
  return quoted ? quoted[2] : trimmed;
}

/**
 * Reads `category`, `hyperwatch.family` and `hyperwatch.identity` from a robot
 * file. Its front matter is plain `key: value` lines, `hyperwatch` being a
 * block of two indented keys (see the database's TEMPLATE.md).
 * @param {string} text
 * @param {string} file For error messages
 * @returns {Robot}
 */
function parseRobot(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    throw new Error(`${file}: no front matter`);
  }
  /** @type {Record<string, string>} */
  const top = {};
  /** @type {Record<string, string>} */
  const hyperwatch = {};
  let block = '';
  for (const line of match[1].split(/\r?\n/)) {
    const entry = line.match(/^( *)([A-Za-z_]+):(.*)$/);
    if (!entry) {
      continue;
    }
    const [, indent, key, value] = entry;
    if (indent === '') {
      block = key;
      top[key] = value;
    } else if (block === 'hyperwatch') {
      hyperwatch[key] = value;
    }
  }
  for (const [name, values] of /** @type {const} */ ([
    ['category', top],
    ['hyperwatch', top],
    ['family', hyperwatch],
    ['identity', hyperwatch],
  ])) {
    if (!(name in values)) {
      throw new Error(`${file}: no ${name} in the front matter`);
    }
  }
  const category = scalar(top.category);
  if (!category) {
    throw new Error(`${file}: empty category`);
  }
  return {
    file,
    category,
    family: scalar(hyperwatch.family),
    identity: scalar(hyperwatch.identity),
  };
}

/**
 * The categories by identity. Robots without an identity are left out: only
 * verified requests get a category.
 *
 * An identity whose robots all have the same category gets that category,
 * whatever the user agent. Otherwise it gets the category of each agent
 * family, and a request with another family has none: Hyperwatch says what a
 * robot is where the database does, and nothing where it would be a guess.
 * Robots without a family count when comparing, and can't be keys.
 * @param {Robot[]} robots
 * @returns {Categories}
 */
function build(robots) {
  /** @type {Map<string, Robot[]>} */
  const byIdentity = new Map();
  for (const robot of robots) {
    if (!CATEGORIES.includes(robot.category)) {
      throw new Error(
        `${robot.file}: unknown category "${robot.category}" (add it to CATEGORIES in scripts/lib/robot-categories.js if the database now has it)`
      );
    }
    if (robot.identity === null) {
      continue;
    }
    byIdentity.set(robot.identity, [
      ...(byIdentity.get(robot.identity) || []),
      robot,
    ]);
  }

  /** @type {Categories} */
  const categories = {};
  for (const identity of [...byIdentity.keys()].sort()) {
    const files = /** @type {Robot[]} */ (byIdentity.get(identity));
    if (new Set(files.map((robot) => robot.category)).size === 1) {
      categories[identity] = files[0].category;
      continue;
    }
    /** @type {Map<string, Robot>} */
    const byFamily = new Map();
    for (const robot of files) {
      if (robot.family === null) {
        continue;
      }
      const other = byFamily.get(robot.family);
      if (other && other.category !== robot.category) {
        throw new Error(
          `${identity}: the family ${robot.family} is ${other.category} in ${other.file} and ${robot.category} in ${robot.file}`
        );
      }
      byFamily.set(robot.family, robot);
    }
    categories[identity] = Object.fromEntries(
      [...byFamily.keys()]
        .sort()
        .map((family) => [
          family,
          /** @type {Robot} */ (byFamily.get(family)).category,
        ])
    );
  }
  return categories;
}

/**
 * What src/modules/identity.js can set, read from its source: the pairs of
 * agent family and identity of its `switch`, and the identities set whatever
 * the family (signed only, hostname only, Google's pools, signature).
 *
 * `unknown` lists the `set('identity', …)` it couldn't read: a new way of
 * writing a rule, to teach this function (test/scripts/robot-categories.js
 * fails until then).
 * @param {string} source
 * @returns {{ pairs: Array<[string, string]>, anyFamily: string[], unknown: string[] }}
 */
function scanIdentities(source) {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  /** @type {Set<string>} */
  const anyFamily = new Set();
  /** @type {string[]} */
  const unknown = [];

  // Identities held in tables and helpers, set through a variable
  /** @type {Record<string, string[]>} */
  const variables = {
    signer: block(source, /const signedOnly = new Map\(\[/, /^\]\);/m).map(
      (line) => (line.match(/^\s*\['[^']+', '([^']+)'\],?$/) || [])[1]
    ),
    identity: block(source, /const hostnameOnly = /, /^\]\)\.map\(/m).map(
      (line) => (line.match(/^\s*\['([^']+)', \[/) || [])[1]
    ),
    google: block(source, /^function googleFetcher\(/m, /^}$/m).map(
      (line) => (line.match(/^\s*return '([^']+)';$/) || [])[1]
    ),
  };
  for (const [name, values] of Object.entries(variables)) {
    variables[name] = values.filter(Boolean);
    if (variables[name].length === 0) {
      unknown.push(`no identity found for the variable "${name}"`);
    }
  }

  let inSwitch = false;
  /** @type {string[]} */
  let cases = [];
  let previousWasCase = false;
  for (const line of source.split('\n')) {
    const code = line.trim();
    if (code === 'switch (family) {') {
      inSwitch = true;
      continue;
    }
    // The switch closes at the indentation it opened
    if (inSwitch && line === '  }') {
      inSwitch = false;
      cases = [];
    }
    const label = inSwitch && code.match(/^case '([^']+)':/);
    if (label) {
      cases = previousWasCase ? [...cases, label[1]] : [label[1]];
      previousWasCase = true;
      continue;
    }
    if (code !== '' && !code.startsWith('//')) {
      previousWasCase = false;
    }
    for (const [whole, argument] of line.matchAll(
      /\.set\(\s*'identity',\s*([^)]*)\)/g
    )) {
      const literal = argument.match(/^'([^']+)'$/);
      /** @type {string[]} */
      let identities;
      if (literal) {
        identities = [literal[1]];
      } else if (argument === 'family' && inSwitch) {
        // The identity is the family itself
        pairs.push(
          .../** @type {Array<[string, string]>} */ (
            cases.map((family) => [family, family])
          )
        );
        continue;
      } else if (argument in variables) {
        identities = variables[argument];
      } else {
        unknown.push(whole);
        continue;
      }
      for (const identity of identities) {
        if (inSwitch) {
          for (const family of cases) {
            pairs.push([family, identity]);
          }
        } else {
          anyFamily.add(identity);
        }
      }
    }
  }
  return { pairs, anyFamily: [...anyFamily].sort(), unknown };
}

/**
 * The lines of `source` between the line matching `start` and the next line
 * matching `end`.
 * @param {string} source
 * @param {RegExp} start
 * @param {RegExp} end
 * @returns {string[]}
 */
function block(source, start, end) {
  const from = source.search(start);
  if (from === -1) {
    return [];
  }
  const rest = source.slice(from);
  const to = rest.search(end);
  return (to === -1 ? rest : rest.slice(0, to)).split('\n').slice(1);
}

/**
 * What a maintainer should read before a release: what has no category, and
 * what changed since the committed file.
 * @param {Categories} categories
 * @param {ReturnType<typeof scanIdentities>} scan
 * @param {Categories} previous
 * @returns {string[]} Lines
 */
function report(categories, scan, previous) {
  const lines = [];
  const set = new Set([...scan.pairs.map(([, id]) => id), ...scan.anyFamily]);

  const without = [...set].filter((id) => !Object.hasOwn(categories, id));
  lines.push(
    `Identities without a category (${without.length}): no robot file names them.`,
    ...without.sort().map((id) => `  ${id}`)
  );

  const gaps = scan.pairs.filter(
    ([family, identity]) =>
      typeof categories[identity] === 'object' &&
      !lookup(categories, identity, family)
  );
  lines.push(
    `Agent families without a category under an identity of several categories (${gaps.length}):`,
    ...gaps.map(([family, identity]) => `  ${identity}: ${family}`)
  );
  const mixedAnyFamily = scan.anyFamily.filter(
    (identity) => typeof categories[identity] === 'object'
  );
  lines.push(
    `Identities of several categories also set whatever the agent family (${mixedAnyFamily.length}): no category unless the family is one of theirs.`,
    ...mixedAnyFamily.map((id) => `  ${id}`)
  );

  const stale = Object.keys(categories).filter((id) => !set.has(id));
  lines.push(
    `Identities of the database that src/modules/identity.js doesn't set (${stale.length}):`,
    ...stale.map((id) => `  ${id}`)
  );

  const describe = (/** @type {string | Record<string, string>} */ entry) =>
    typeof entry === 'string'
      ? entry
      : `per family (${Object.entries(entry)
          .map(([family, category]) => `${family}: ${category}`)
          .join(', ')})`;
  const changes = [];
  for (const id of new Set([
    ...Object.keys(previous),
    ...Object.keys(categories),
  ])) {
    const [before, after] = [previous[id], categories[id]];
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push(
        `  ${id}: ${before === undefined ? 'none' : describe(before)} -> ${after === undefined ? 'none' : describe(after)}`
      );
    }
  }
  lines.push(
    `Changes since the committed file (${changes.length}):`,
    ...changes.sort()
  );
  return lines;
}

module.exports = {
  CATEGORIES,
  build,
  parseRobot,
  report,
  scanIdentities,
};
