/**
 * Track distinct keys with the time they were last seen, bounded to a
 * rolling window. Backs the addressCount15m/24h and signatureCount15m/24h
 * counters.
 */
const { Map } = require('immutable');

const { now } = require('./util');

// Rolling window in seconds
const WINDOW = 24 * 3600;

/** @typedef {import('immutable').Map<string, number>} RecentMap */

// Record `key` as seen at `time` in an Immutable Map<key, unix seconds>
/**
 * @param {RecentMap | undefined} map
 * @param {string} key
 * @param {number} [time]
 * @returns {RecentMap}
 */
const touch = (map = Map(), key, time = now()) => map.set(key, time);

// Drop keys not seen in the last WINDOW seconds
/**
 * @param {RecentMap} map
 * @param {number} [time]
 * @returns {RecentMap}
 */
const prune = (map, time = now()) => map.filter((seen) => seen > time - WINDOW);

// Number of keys seen in the last `window` seconds
/**
 * @param {RecentMap | undefined} map
 * @param {number} [window]
 * @param {number} [time]
 * @returns {number}
 */
const countRecent = (map, window = WINDOW, time = now()) =>
  map ? map.count((seen) => seen > time - window) : 0;

module.exports = { WINDOW, touch, prune, countRecent };
