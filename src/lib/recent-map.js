/**
 * Track distinct keys with the time they were last seen, bounded to a
 * rolling window. Backs the addressCount / signatureCount counters.
 */
const { Map } = require('immutable');

const { now } = require('./util');

// Rolling window in seconds
const WINDOW = 24 * 3600;

// Record `key` as seen at `time` in an Immutable Map<key, unix seconds>
const touch = (map = Map(), key, time = now()) => map.set(key, time);

// Drop keys not seen in the last WINDOW seconds
const prune = (map, time = now()) => map.filter((seen) => seen > time - WINDOW);

module.exports = { WINDOW, touch, prune };
