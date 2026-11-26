const assert = require('assert');

const { fromJS } = require('immutable');

const {
  Aggregator,
  defaultFormatter,
  lastSeen,
} = require('../../src/lib/aggregator');
const { toHtml } = require('../../src/lib/util');

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

describe('Aggregator entryGc', () => {
  it('runs on gc() even below gcSize', () => {
    const agg = new Aggregator();
    agg.entries = agg.entries.setIn(['a', 'n'], 1).setIn(['b', 'n'], 2);
    agg.setEntryGc((entry) => entry.update('n', (n) => n * 10));

    assert.ok(agg.entries.size < agg.gcSize);
    agg.gc();

    assert.strictEqual(agg.entries.getIn(['a', 'n']), 10);
    assert.strictEqual(agg.entries.getIn(['b', 'n']), 20);
    assert.strictEqual(agg.entries.size, 2);
  });
});

describe('Aggregator lastSeen', () => {
  const entry = fromJS({ speed: {} }).setIn(['speed', 'per_minute'], {
    latest: Date.UTC(2026, 8, 25, 12, 51, 7) / 1000,
  });

  it('is ISO 8601 in text output', () => {
    assert.strictEqual(lastSeen(entry, 'text'), '2026-09-25T12:51:07.000Z');
  });

  it('is shorter in HTML output', () => {
    assert.strictEqual(
      toHtml(lastSeen(entry, 'html')),
      '2026-09-25&nbsp;12:51:07'
    );
  });

  it('is empty when never seen', () => {
    assert.strictEqual(lastSeen(fromJS({ speed: {} }), 'html'), '');
  });
});

describe('Aggregator getData filter', () => {
  const aggregator = new Aggregator();
  aggregator.sorters.n = (entry) => entry.get('n');
  aggregator.entries = fromJS({
    a: { identity: 'Googlebot', n: 3 },
    b: { n: 2 },
    c: { identity: 'Bing', n: 1 },
  });

  const identities = (options) =>
    aggregator
      .getData({ sort: 'n', raw: true, ...options })
      .map((entry) => entry.get('identity') || '-')
      .toArray();

  it('keeps every entry without a filter', () => {
    assert.deepStrictEqual(identities(), ['Googlebot', '-', 'Bing']);
  });

  it('filters before limiting', () => {
    assert.deepStrictEqual(
      identities({ filter: (entry) => !entry.get('identity'), limit: 1 }),
      ['-']
    );
    assert.deepStrictEqual(
      identities({ filter: (entry) => !!entry.get('identity'), limit: 2 }),
      ['Googlebot', 'Bing']
    );
  });
});

describe('Aggregator identifier', () => {
  const log = (fields) => fromJS({ executionTime: 10, ...fields });

  it('leaves out the logs without an identifier, without throwing', () => {
    const aggregator = new Aggregator();
    aggregator.setIdentifier((entry) => entry.get('key'));
    const without = log({});
    assert.strictEqual(aggregator.processLog(without), without);
    aggregator.processLog(log({ key: null }));
    assert.strictEqual(aggregator.entries.size, 0);

    aggregator.processLog(log({ key: 'a' }));
    aggregator.processLog(log({ key: '' }));
    assert.deepStrictEqual(
      aggregator.entries
        .toList()
        .map((entry) => entry.get('identifier'))
        .toArray()
        .sort(),
      ['', 'a']
    );
  });
});

describe('Aggregator status speeds', () => {
  const log = (key, status) =>
    fromJS({ key, executionTime: 10, response: { status } });
  const aggregator = () => {
    const a = new Aggregator();
    a.setIdentifier((entry) => entry.get('key'));
    return a;
  };
  const speedKeys = (a, key) =>
    [
      ...a.entries
        .find((e) => e.get('identifier') === key)
        .get('speed')
        .keys(),
    ].sort();

  it('creates the 2xx and 4xx speeds at their first hit', () => {
    const a = aggregator();
    a.processLog(log('a', 304));
    assert.deepStrictEqual(speedKeys(a, 'a'), ['per_hour', 'per_minute']);
    // Counted as 0 without them
    const entry = a.entries.first();
    assert.strictEqual(a.sorters['2xx15m'](entry), 0);
    assert.strictEqual(a.sorters['4xx24h'](entry), 0);

    a.processLog(log('a', 200));
    a.processLog(log('a', 404));
    a.processLog(log('a', 404));
    assert.deepStrictEqual(speedKeys(a, 'a'), [
      '2xx_per_hour',
      '2xx_per_minute',
      '4xx_per_hour',
      '4xx_per_minute',
      'per_hour',
      'per_minute',
    ]);
    const updated = a.entries.first();
    assert.strictEqual(a.sorters.count15m(updated), 4);
    assert.strictEqual(a.sorters['2xx15m'](updated), 1);
    assert.strictEqual(a.sorters['4xx24h'](updated), 2);
  });

  it('restores the status speeds that had hits only', () => {
    const source = aggregator();
    source.processLog(log('a', 200));
    const dumped = JSON.parse(JSON.stringify(source.dump()));
    // As documents of earlier versions have them: all four, empty ones too
    const empty = (windowSize, size) => ({
      windowSize,
      size,
      counters: {},
      sums: {},
      started: null,
      latest: null,
    });
    dumped[0].speed['4xx_per_minute'] = empty(60, 15);
    dumped[0].speed['4xx_per_hour'] = empty(3600, 24);

    const restored = aggregator();
    restored.load(dumped);
    assert.deepStrictEqual(speedKeys(restored, 'a'), [
      '2xx_per_hour',
      '2xx_per_minute',
      'per_hour',
      'per_minute',
    ]);
    assert.strictEqual(restored.sorters['2xx24h'](restored.entries.first()), 1);
  });
});
