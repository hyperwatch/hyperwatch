/**
 * What a refresh changed in src/data, as the table of a refresh pull request
 * (see RELEASING.md): the ranges added and removed per list, and the Web Bot
 * Auth keys per agent, by thumbprint.
 */
const { thumbprint } = require('../../src/lib/webbotauth');

const KEYS_FILE = 'webbotauth-keys.json';

// At most this many entries listed per cell, then a count
const SHOWN = 10;

/** @param {string[]} values */
function list(values) {
  const shown = values.slice(0, SHOWN).map((value) => `\`${value}\``);
  const more = values.length - shown.length;
  return more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', ');
}

/**
 * @param {string[]} before
 * @param {string[]} after
 */
function difference(before, after) {
  const old = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter((value) => !old.has(value)),
    removed: before.filter((value) => !now.has(value)),
  };
}

/** @param {{ added: string[], removed: string[] }} change */
function cell({ added, removed }, what = '') {
  return [
    added.length ? `+ ${what}${list(added)}` : '',
    removed.length ? `− ${what}${list(removed)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * @typedef {{ name: string, before: any, after: any }} DataFile
 *   A file of src/data, parsed, before and after the refresh (null when it
 *   didn't exist)
 */

/**
 * The rows of the table, and whether anything was removed
 * @param {DataFile[]} files
 */
function rows(files) {
  const table = [];
  let removed = false;
  for (const { name, before, after } of files) {
    if (name === KEYS_FILE) {
      const agents = [
        ...new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
      ].sort();
      for (const agent of agents) {
        const keys = (jwks) => (jwks || []).map((jwk) => thumbprint(jwk));
        const change = difference(
          keys((before || {})[agent]),
          keys((after || {})[agent])
        );
        if (change.added.length || change.removed.length) {
          removed = removed || change.removed.length > 0;
          table.push(
            `| \`${name}\` (\`${agent}\`) | ${cell(change, 'key ')} |`
          );
        }
      }
    } else if (Array.isArray(after) || Array.isArray(before)) {
      const change = difference(before || [], after || []);
      if (change.added.length || change.removed.length) {
        removed = removed || change.removed.length > 0;
        table.push(`| \`${name}\` | ${cell(change)} |`);
      }
    }
  }
  return { table, removed };
}

/**
 * The Markdown of a refresh pull request's changes: the table, or null when
 * nothing changed
 * @param {DataFile[]} files
 */
function dataChanges(files) {
  const { table, removed } = rows(files);
  if (table.length === 0) {
    return null;
  }
  return [
    '| List | Change |',
    '|---|---|',
    ...table,
    '',
    removed ? 'Some entries were removed: check them.' : 'Nothing was removed.',
    'The other fetched lists are unchanged.',
  ].join('\n');
}

/**
 * The title of the refresh pull request, from the files that changed
 * @param {string[]} names
 */
function refreshTitle(names) {
  const keys = names.includes(KEYS_FILE);
  const ranges = names.some((name) => name !== KEYS_FILE);
  if (keys && ranges) {
    return 'Refresh the published IP ranges and Web Bot Auth keys';
  }
  return keys
    ? 'Refresh the Web Bot Auth keys'
    : 'Refresh the published IP ranges';
}

module.exports = { dataChanges, refreshTitle };
