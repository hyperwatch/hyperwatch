const assert = require('assert');

const { Speed } = require('../../src/lib/speed');
const { now } = require('../../src/lib/util');

describe('Speed', () => {
  it('count hits per fixed time windows', () => {
    const windowSize = 10;
    const size = 5;
    const s = new Speed(windowSize, size);
    const t = now();
    s.hit(t - 3 * windowSize);
    s.hit(t - 3 * windowSize);
    s.hit(t - 1 * windowSize);
    assert.deepStrictEqual(s.compute().toJS(), [0, 1, 0, 2]);
  });

  it('garbage collects old hits', () => {
    const windowSize = 10;
    const size = 5;
    const s = new Speed(windowSize, size);
    const t = now();
    s.hit(t - 7 * windowSize);
    s.hit(t - 6 * windowSize);
    s.hit(t - 5 * windowSize);
    s.hit(t - 3 * windowSize);
    s.hit(t - 3 * windowSize);
    s.hit(t - 1 * windowSize);
    assert.deepStrictEqual(s.compute().toJS(), [0, 1, 0, 2, 0]);
  });

  it('tracks sums per time window', () => {
    const windowSize = 10;
    const size = 5;
    const s = new Speed(windowSize, size);
    const t = now();
    s.hit(t - 3 * windowSize, 100);
    s.hit(t - 3 * windowSize, 250);
    s.hit(t - 1 * windowSize, 50);
    assert.deepStrictEqual(s.computeSum().toJS(), [0, 50, 0, 350]);
  });

  it('garbage collects old sums', () => {
    const windowSize = 10;
    const size = 5;
    const s = new Speed(windowSize, size);
    const t = now();
    s.hit(t - 7 * windowSize, 999);
    s.hit(t - 6 * windowSize, 888);
    s.hit(t - 5 * windowSize, 777);
    s.hit(t - 3 * windowSize, 100);
    s.hit(t - 3 * windowSize, 200);
    s.hit(t - 1 * windowSize, 50);
    assert.deepStrictEqual(s.computeSum().toJS(), [0, 50, 0, 300, 0]);
  });

  it('returns zero sums for windows with no value', () => {
    const windowSize = 10;
    const size = 5;
    const s = new Speed(windowSize, size);
    const t = now();
    s.hit(t - 3 * windowSize);
    s.hit(t - 1 * windowSize, 50);
    assert.deepStrictEqual(s.computeSum().toJS(), [0, 50, 0, 0]);
  });

  it('returns empty list for computeSum with no hits', () => {
    const s = new Speed(10, 5);
    assert.deepStrictEqual(s.computeSum().toJS(), []);
  });
});

describe('Speed windows', () => {
  const { SpeedV1 } = require('../helpers/speed-v1');

  // Sums of windows without value read 0 either way; the old JSON kept a 0
  // key for them
  const withoutZeroSums = (json) => ({
    ...json,
    sums: Object.fromEntries(
      Object.entries(json.sums).filter(([, value]) => value !== 0)
    ),
  });

  it('counts and sums like the previous Speed, hits in any order', () => {
    // A fixed pseudo-random sequence
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const [windowSize, size] of [
      [60, 15],
      [3600, 24],
      [10, 5],
    ]) {
      for (let run = 0; run < 20; run++) {
        const a = new Speed(windowSize, size);
        const b = new SpeedV1(windowSize, size);
        const t = now();
        const hits = Math.floor(random() * 40);
        for (let h = 0; h < hits; h++) {
          // Some hits too old to keep, most within the period
          const time = t - Math.floor(random() * windowSize * (size + 3));
          const value = random() < 0.3 ? undefined : random() * 1000;
          a.hit(time, value);
          b.hit(time, value);
        }
        assert.deepStrictEqual(a.compute(t).toJS(), b.compute(t).toJS());
        assert.deepStrictEqual(
          a.computeSum(t).toJS().map(Math.round),
          b.computeSum(t).toJS().map(Math.round)
        );
        assert.deepStrictEqual(
          withoutZeroSums(a.toJSON()),
          withoutZeroSums(b.toJSON())
        );
      }
    }
  });

  it('keeps no array before the first hit, nor once every window is old', () => {
    const s = new Speed(10, 5);
    assert.strictEqual(s.windows, null);
    s.hit(now() - 100);
    assert.strictEqual(s.windows, null);
    // Started: zeros, as before
    assert.deepStrictEqual(s.compute().toJS(), [0, 0, 0, 0, 0]);
  });

  it('keeps windows in order, one per start', () => {
    const s = new Speed(10, 5);
    const t = now() - (now() % 10);
    s.hit(t - 10, 1);
    s.hit(t - 30, 2);
    s.hit(t - 10, 3);
    s.hit(t - 20);
    assert.deepStrictEqual(s.windows, [
      t - 30,
      1,
      2,
      t - 20,
      1,
      0,
      t - 10,
      2,
      4,
    ]);
  });

  it('restores the JSON of the previous Speed', () => {
    const t = now();
    const old = new SpeedV1(60, 15);
    old.hit(t - 120, 0);
    old.hit(t - 60, 30);
    old.hit(t);
    const restored = Speed.fromJSON(JSON.parse(JSON.stringify(old.toJSON())));
    assert.deepStrictEqual(restored.compute(t).toJS(), old.compute(t).toJS());
    assert.deepStrictEqual(
      restored.computeSum(t).toJS(),
      old.computeSum(t).toJS()
    );
    assert.strictEqual(restored.started, old.started);
    assert.strictEqual(restored.latest, old.latest);
  });
});
