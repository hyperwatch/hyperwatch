const assert = require('assert');

const { Map } = require('immutable');

const pipeline = require('../../src/lib/pipeline');

describe('Pipeline rate tracking', () => {
  it('uses a bounded set of buckets for the ten-second rate', () => {
    const originalNow = Date.now;
    const originalCounter = pipeline.counter;
    const originalBuckets = pipeline.rateBuckets;

    try {
      pipeline.counter = 0;
      pipeline.rateBuckets = Array.from({ length: 10 }, () => ({
        second: null,
        count: 0,
      }));
      const stream = pipeline.create()(() => {});

      for (let second = 0; second < 20; second++) {
        Date.now = () => second * 1000;
        for (let event = 0; event < 5; event++) {
          stream(Map());
        }
      }

      assert.strictEqual(pipeline.counter, 100);
      assert.strictEqual(pipeline.rateBuckets.length, 10);
      assert.strictEqual(pipeline.getTree().rate, 5);
    } finally {
      Date.now = originalNow;
      pipeline.counter = originalCounter;
      pipeline.rateBuckets = originalBuckets;
    }
  });
});
