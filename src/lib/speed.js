/**
 * Keep track of an entity's speed per fixed time windows.
 *
 * Windows that had hits are kept in one flat array of numbers, oldest first:
 * [start, hits, sum, start, hits, sum…]. Most entries of an aggregator see a
 * few hits in a few windows, and each has six speeds (all, 2xx and 4xx, per
 * minute and per hour): an array of numbers is stored unboxed (8 bytes a
 * slot), where Immutable Maps keyed by strings took several hundred bytes a
 * speed. No array at all until the first hit.
 */
const { List, Range } = require('immutable');

const { now } = require('./util');

// Slots per window in `windows`
const START = 0;
const HITS = 1;
const SUM = 2;
const STRIDE = 3;

class Speed {
  /**
   * @param {number} windowSize Seconds in a window
   * @param {number} size Number of windows kept
   */
  constructor(windowSize, size) {
    this.windowSize = windowSize;
    this.size = size;
    /** @type {number[] | null} [start, hits, sum…] by window, oldest first */
    this.windows = null;
    /** @type {number | null} */
    this.started = null;
    /** @type {number | null} */
    this.latest = null;
  }

  // delete windows that are too old
  gc() {
    const windows = this.windows;
    if (!windows) {
      return;
    }
    const cutoff = now() - this.size * this.windowSize;
    let i = 0;
    while (i < windows.length && windows[i + START] <= cutoff) {
      i += STRIDE;
    }
    if (i === windows.length) {
      this.windows = null;
    } else if (i > 0) {
      // A new array of the exact length: splice() keeps the spare capacity
      this.windows = windows.slice(i);
    }
  }

  /**
   * The index in `windows` of the window starting at `start`, -1 if it had
   * no hit
   * @param {number} start
   */
  indexOf(start) {
    const windows = this.windows;
    if (windows) {
      for (let i = windows.length - STRIDE; i >= 0; i -= STRIDE) {
        if (windows[i + START] === start) {
          return i;
        }
        if (windows[i + START] < start) {
          break;
        }
      }
    }
    return -1;
  }

  /**
   * @param {number} [time] Seconds since Unix epoch
   * @param {number} [value] Added to the sum of the window
   * @returns {this}
   */
  hit(time = now(), value) {
    this.started = !this.started ? time : Math.min(this.started, time);
    this.latest = !this.latest ? time : Math.max(this.latest, time);
    const start = time - (time % this.windowSize);
    const add = value === undefined ? 0 : value;
    const windows = this.windows;
    const i = this.indexOf(start);
    if (windows && i >= 0) {
      windows[i + HITS] += 1;
      windows[i + SUM] += add;
    } else if (!windows) {
      this.windows = [start, 1, add];
    } else {
      // After the last window, unless the hit is older (out of order). A new
      // array of the exact length: push() and splice() reserve spare
      // capacity, which would cost more than the windows themselves
      let at = windows.length;
      while (at > 0 && windows[at - STRIDE + START] > start) {
        at -= STRIDE;
      }
      this.windows = windows
        .slice(0, at)
        .concat([start, 1, add], windows.slice(at));
    }
    this.gc();
    return this;
  }

  /**
   * A slot of each window, most recent first, since the first hit
   * @param {number} slot
   * @param {number} time
   * @returns {IndexedNumbers}
   */
  series(slot, time) {
    this.gc();
    if (!this.started) {
      return List();
    }
    // Not null once hit()
    const started = /** @type {number} */ (this.started);
    const first = started - (started % this.windowSize);
    return Range(0, this.size)
      .map((n) => {
        let t = time - n * this.windowSize;
        t = t - (t % this.windowSize);
        if (t >= first) {
          const i = this.indexOf(t);
          return i >= 0 ? /** @type {number[]} */ (this.windows)[i + slot] : 0;
        }
      })
      .filter((v) => v !== undefined);
  }

  /**
   * Hits per window, most recent first, since the first hit
   * @param {number} [time]
   * @returns {IndexedNumbers}
   */
  compute(time = now()) {
    return this.series(HITS, time);
  }

  /**
   * Sums per window, most recent first, since the first hit
   * @param {number} [time]
   * @returns {IndexedNumbers}
   */
  computeSum(time = now()) {
    return this.series(SUM, time);
  }

  /**
   * As persisted and served in raw entries: hits and sums by window start.
   * Windows whose sum is 0 have no `sums` key (a missing key reads as 0).
   * @returns {SpeedJSON}
   */
  toJSON() {
    /** @type {Record<string, number>} */
    const counters = {};
    /** @type {Record<string, number>} */
    const sums = {};
    const windows = this.windows || [];
    for (let i = 0; i < windows.length; i += STRIDE) {
      counters[windows[i + START]] = windows[i + HITS];
      if (windows[i + SUM] !== 0) {
        sums[windows[i + START]] = windows[i + SUM];
      }
    }
    return {
      windowSize: this.windowSize,
      size: this.size,
      counters,
      sums,
      started: this.started,
      latest: this.latest,
    };
  }

  /**
   * @param {SpeedJSON} data
   * @returns {Speed}
   */
  static fromJSON(data) {
    const speed = new Speed(data.windowSize, data.size);
    const counters = data.counters || {};
    const sums = data.sums || {};
    const starts = [
      ...new Set([...Object.keys(counters), ...Object.keys(sums)]),
    ]
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (starts.length) {
      // Of the exact length (see hit())
      const windows = new Array(starts.length * STRIDE).fill(0);
      starts.forEach((start, n) => {
        windows[n * STRIDE + START] = start;
        windows[n * STRIDE + HITS] = Number(counters[start]) || 0;
        windows[n * STRIDE + SUM] = Number(sums[start]) || 0;
      });
      speed.windows = windows;
    }
    speed.started = data.started;
    speed.latest = data.latest;
    return speed;
  }
}

/**
 * A Speed as persisted (Speed#toJSON)
 * @typedef {object} SpeedJSON
 * @property {number} windowSize
 * @property {number} size
 * @property {Record<string, number>} counters
 * @property {Record<string, number>} sums
 * @property {number | null} started
 * @property {number | null} latest
 */

/** @typedef {import('immutable').Collection.Indexed<number>} IndexedNumbers */

module.exports.Speed = Speed;
