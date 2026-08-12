const assert = require('assert');

const { Aggregator, defaultFormatter } = require('../../src/lib/aggregator');

describe('Aggregator formatter isolation', () => {
  it('gives each aggregator its own formatter', () => {
    const agg1 = new Aggregator();
    const agg2 = new Aggregator();

    assert.notStrictEqual(agg1.formatter, agg2.formatter);
    assert.notStrictEqual(agg1.formatter, defaultFormatter);
  });

  it('does not leak insertFormat between aggregators', () => {
    const agg1 = new Aggregator();

    agg1.formatter.insertFormat('signatureCount', () => 0, {
      before: 'count15m',
    });

    const agg2 = new Aggregator();

    const keys1 = agg1.formatter.formats.map(([key]) => key);
    const keys2 = agg2.formatter.formats.map(([key]) => key);
    assert.ok(keys1.includes('signatureCount'));
    assert.ok(!keys2.includes('signatureCount'));

    const defaultKeys = defaultFormatter.formats.map(([key]) => key);
    assert.ok(!defaultKeys.includes('signatureCount'));
  });

  it('picks up defaultFormatter formats added before construction', () => {
    defaultFormatter.insertFormat('country', () => '', { after: 'address' });
    try {
      const agg = new Aggregator();
      const keys = agg.formatter.formats.map(([key]) => key);
      assert.ok(keys.includes('country'));
    } finally {
      defaultFormatter.formats = defaultFormatter.formats.filter(
        ([key]) => key !== 'country'
      );
    }
  });
});
