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
    this.started = null;
    this.latest = null;
  }

  // delete counters that are too old
  gc() {
    const cutoff = now() - this.size * this.windowSize;
    this.counters = this.counters.filter((c, t) => parseInt(t) > cutoff);
  }

  hit(time = now()) {
    this.started = !this.started ? time : Math.min(this.started, time);
    this.latest = !this.latest ? time : Math.max(this.latest, time);
    const idx = time - (time % this.windowSize);
    this.counters = this.counters.update(`${idx}`, 0, (n) => n + 1);
    this.gc();
    return this;
  }

  compute() {
    this.gc();
    if (!this.started) {
      return List();
    }
    const time = now();
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
}

module.exports = {
  Speed: Speed,
};
