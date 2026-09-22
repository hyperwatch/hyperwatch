const assert = require('assert');

const { Map } = require('immutable');

const { WINDOW, touch, prune } = require('../../src/lib/recent-map');

describe('recent-map', () => {
  const t0 = 1700000000;

  it('touch adds a key and refreshes an existing one', () => {
    let map = touch(undefined, 'a', t0);
    assert.ok(Map.isMap(map));
    assert.strictEqual(map.get('a'), t0);

    map = touch(map, 'a', t0 + 5);
    assert.strictEqual(map.size, 1);
    assert.strictEqual(map.get('a'), t0 + 5);

    map = touch(map, 'b', t0 + 6);
    assert.strictEqual(map.size, 2);
  });

  it('prune drops keys at or beyond the window boundary', () => {
    const now = t0 + WINDOW;
    const map = Map({
      exact: t0, // seen exactly WINDOW ago → dropped
      inside: t0 + 1, // one second inside → kept
      recent: now,
    });
    const pruned = prune(map, now);
    assert.deepStrictEqual(pruned.keySeq().sort().toArray(), [
      'inside',
      'recent',
    ]);
  });

  it('a stale key is dropped, a refreshed key survives', () => {
    const later = t0 + WINDOW + 10;

    const stale = touch(undefined, 'a', t0);
    assert.strictEqual(prune(stale, later).size, 0);

    let refreshed = touch(undefined, 'a', t0);
    refreshed = touch(refreshed, 'a', t0 + WINDOW - 10);
    assert.strictEqual(prune(refreshed, later).size, 1);
    assert.strictEqual(prune(refreshed, later).get('a'), t0 + WINDOW - 10);
  });
});
