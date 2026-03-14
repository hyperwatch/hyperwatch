/**
 * Keep track of an entity's speed per fixed time windows.
 */
const { Map, List, Range } = require('immutable');

const { now } = require('./util');

class Speed {
  constructor(windowSize, size) {
    this.windowSize = windowSize;
    this.size = size;
    this.counters = Map();
    this.sums = Map();
    this.started = null;
    this.latest = null;
  }

  // delete counters that are too old
  gc() {
    const cutoff = now() - this.size * this.windowSize;
    this.counters = this.counters.filter((c, t) => parseInt(t) > cutoff);
    this.sums = this.sums.filter((c, t) => parseInt(t) > cutoff);
  }

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

  compute(time = now()) {
    this.gc();
    if (!this.started) {
      return List();
    }
    return Range(0, this.size)
      .map((n) => {
        let t = time - n * this.windowSize;
        t = t - (t % this.windowSize);
        if (t >= this.started - (this.started % this.windowSize)) {
          return this.counters.get(`${t}`, 0);
        }
      })
      .filter((v) => v !== undefined);
  }

  computeSum(time = now()) {
    this.gc();
    if (!this.started) {
      return List();
    }
    return Range(0, this.size)
      .map((n) => {
        let t = time - n * this.windowSize;
        t = t - (t % this.windowSize);
        if (t >= this.started - (this.started % this.windowSize)) {
          return this.sums.get(`${t}`, 0);
        }
      })
      .filter((v) => v !== undefined);
  }

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

  static fromJSON(data) {
    const speed = new Speed(data.windowSize, data.size);
    speed.counters = Map(data.counters);
    speed.sums = Map(data.sums);
    speed.started = data.started;
    speed.latest = data.latest;
    return speed;
  }
}

module.exports = {
  Speed: Speed,
};
