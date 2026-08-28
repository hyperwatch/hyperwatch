const assert = require('assert');

const { Map } = require('immutable');

const aggregator = require('../../src/lib/aggregator');
const { Speed } = require('../../src/lib/speed');
const { now } = require('../../src/lib/util');
const sparkline = require('../../src/modules/sparkline');

describe('Sparkline formatter', () => {
  it('omits HTML activity from text output', () => {
    const originalFormats = aggregator.defaultFormatter.formats;

    try {
      sparkline.init();
      const time = now();
      const speed = new Speed(60, 15)
        .hit(time - 120)
        .hit(time - 60)
        .hit(time);
      const entry = Map({ id: 'test' }).setIn(['speed', 'per_minute'], speed);

      const activity = aggregator.defaultFormatter.formats.find(
        ([key]) => key === 'activity'
      )[1];
      assert.strictEqual(activity(entry, 'text'), undefined);
    } finally {
      aggregator.defaultFormatter.formats = originalFormats;
    }
  });
});
