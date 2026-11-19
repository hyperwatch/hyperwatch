// The category of a verified robot (search-engine, seo, social-preview…),
// from src/data/robot-categories.json: built from the robots database
// (https://github.com/hyperwatch/database) by scripts/robot-categories.js.

/**
 * The categories of an identity's robots: a string when all its robots have
 * the same one, else the category of each agent family.
 * @typedef {Record<string, string | Record<string, string>>} Categories
 */

/**
 * The category of a request identified as `identity`, with the agent family
 * `family`. The family only counts under the identity that was verified: a
 * request can claim any user agent, and a robot signing as one operator
 * doesn't become another's by sending its user agent. Undefined when the
 * database doesn't say: an identity without robot file, or a family it
 * doesn't list under an identity whose robots differ.
 * @param {Categories} categories
 * @param {string} identity
 * @param {string | null | undefined} family
 * @returns {string | undefined}
 */
function lookup(categories, identity, family) {
  const entry = Object.hasOwn(categories, identity)
    ? categories[identity]
    : undefined;
  if (typeof entry === 'string') {
    return entry;
  }
  return entry && family && Object.hasOwn(entry, family)
    ? entry[family]
    : undefined;
}

module.exports = { lookup };
