/**
 * Keep track of an entity's speed per fixed time windows.
 */
const { Map, List, Range } = require('immutable');

const { now } = require('./util');

class Speed {
  /**
   * @param {number} windowSize Seconds in a window
   * @param {number} size Number of windows kept
   */
  constructor(windowSize, size) {
    this.windowSize = windowSize;
    this.size = size;
    /** @type {Map<string, number>} Hits by window start */
    this.counters = Map();
    /** @type {Map<string, number>} Sums of values by window start */
    this.sums = Map();
    /** @type {number | null} */
    this.started = null;
    /** @type {number | null} */
    this.latest = null;
  }

  // delete counters that are too old
  gc() {
    const cutoff = now() - this.size * this.windowSize;
    this.counters = this.counters.filter((c, t) => parseInt(t) > cutoff);
    this.sums = this.sums.filter((c, t) => parseInt(t) > cutoff);
  }

  /**
   * @param {number} [time] Seconds since Unix epoch
   * @param {number} [value] Added to the sum of the window
   * @returns {this}
   */
  hit(time = now(), value) {
    this.started = !this.started ? time : Math.min(this.started, time);
    this.latest = !this.latest ? time : Math.max(this.latest, time);
    const idx = time - (time % this.windowSize);
    this.counters = this.counters.update(`${idx}`, 0, (n) => n + 1);
    if (value !== undefined) {
      this.sums = this.sums.update(`${idx}`, 0, (n) => n + value);
    }
    this.gc();
    return this;
  }

  /**
   * Hits per window, most recent first, since the first hit
   * @param {number} [time]
   * @returns {IndexedNumbers}
   */
  compute(time = now()) {
    this.gc();
    if (!this.started) {
      return List();
    }
    return Range(0, this.size)
      .map((n) => {
        // Not null once hit()
        const started = /** @type {number} */ (this.started);
        let t = time - n * this.windowSize;
        t = t - (t % this.windowSize);
        if (t >= started - (started % this.windowSize)) {
          return this.counters.get(`${t}`, 0);
        }
      })
      .filter((v) => v !== undefined);
  }

  /**
   * Sums per window, most recent first, since the first hit
   * @param {number} [time]
   * @returns {IndexedNumbers}
   */
  computeSum(time = now()) {
    this.gc();
    if (!this.started) {
      return List();
    }
    return Range(0, this.size)
      .map((n) => {
        // Not null once hit()
        const started = /** @type {number} */ (this.started);
        let t = time - n * this.windowSize;
        t = t - (t % this.windowSize);
        if (t >= started - (started % this.windowSize)) {
          return this.sums.get(`${t}`, 0);
        }
      })
      .filter((v) => v !== undefined);
  }

  /** @returns {SpeedJSON} */
  toJSON() {
    return {
      windowSize: this.windowSize,
      size: this.size,
      counters: this.counters.toObject(),
      sums: this.sums.toObject(),
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
    speed.counters = Map(data.counters);
    speed.sums = Map(data.sums);
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
