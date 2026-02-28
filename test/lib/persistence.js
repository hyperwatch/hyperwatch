const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Map, Set, fromJS } = require('immutable');

const { Aggregator } = require('../../src/lib/aggregator');
const { Speed } = require('../../src/lib/speed');
const { now } = require('../../src/lib/util');

describe('Speed serialization', () => {
  it('toJSON returns plain object with all fields', () => {
    const s = new Speed(60, 15);
    const t = now();
    s.hit(t, 100);
    s.hit(t, 200);

    const json = s.toJSON();
    assert.strictEqual(json.windowSize, 60);
    assert.strictEqual(json.size, 15);
    assert.strictEqual(json.started, t);
    assert.strictEqual(json.latest, t);
    assert.strictEqual(typeof json.counters, 'object');
    assert.strictEqual(typeof json.sums, 'object');
  });

  it('fromJSON restores a working Speed instance', () => {
    const s = new Speed(10, 5);
    const t = now();
    s.hit(t - 30, 100);
    s.hit(t - 30, 200);
    s.hit(t - 10, 50);

    const restored = Speed.fromJSON(s.toJSON());
    assert.deepStrictEqual(restored.compute().toJS(), s.compute().toJS());
    assert.deepStrictEqual(restored.computeSum().toJS(), s.computeSum().toJS());
    assert.strictEqual(restored.started, s.started);
    assert.strictEqual(restored.latest, s.latest);
  });

  it('fromJSON Speed accepts new hits', () => {
    const s = new Speed(10, 5);
    const t = now();
    s.hit(t - 10, 50);

    const restored = Speed.fromJSON(s.toJSON());
    restored.hit(t, 75);
    assert.deepStrictEqual(restored.compute().toJS(), [1, 1]);
    assert.deepStrictEqual(restored.computeSum().toJS(), [75, 50]);
  });
});

describe('Aggregator dump/load', () => {
  it('round-trips entries with speed data', () => {
    const agg = new Aggregator();
    const t = now();

    // Simulate two entries
    agg.entries = agg.entries
      .setIn(['a', 'id'], 'a')
      .setIn(['a', 'identifier'], '1.2.3.4')
      .setIn(['a', 'speed', 'per_minute'], new Speed(60, 15).hit(t, 100))
      .setIn(['a', 'speed', 'per_hour'], new Speed(3600, 24).hit(t, 100))
      .setIn(['b', 'id'], 'b')
      .setIn(['b', 'identifier'], '5.6.7.8')
      .setIn(['b', 'speed', 'per_minute'], new Speed(60, 15).hit(t, 50))
      .setIn(['b', 'speed', 'per_hour'], new Speed(3600, 24).hit(t, 50));

    const dumped = agg.dump();
    assert.strictEqual(dumped.length, 2);

    const agg2 = new Aggregator();
    agg2.load(dumped);
    assert.strictEqual(agg2.entries.size, 2);
    assert.strictEqual(agg2.entries.getIn(['a', 'identifier']), '1.2.3.4');
    assert.strictEqual(agg2.entries.getIn(['b', 'identifier']), '5.6.7.8');

    const pm = agg2.entries.getIn(['a', 'speed', 'per_minute']);
    assert(pm instanceof Speed);
    assert.deepStrictEqual(pm.compute().toJS(), [1]);
  });

  it('preserves enriched metadata (address, agent, geoip, identity)', () => {
    const agg = new Aggregator();
    const t = now();

    agg.entries = agg.entries
      .setIn(['a', 'id'], 'a')
      .setIn(['a', 'identifier'], '1.2.3.4')
      .setIn(['a', 'speed', 'per_minute'], new Speed(60, 15).hit(t))
      .setIn(['a', 'speed', 'per_hour'], new Speed(3600, 24).hit(t))
      .setIn(['a', 'identity'], 'Googlebot')
      .setIn(
        ['a', 'address'],
        fromJS({ value: '1.2.3.4', hostname: 'bot.google.com' })
      )
      .setIn(
        ['a', 'agent'],
        fromJS({ family: 'Googlebot', major: '2', os: { family: 'Other' } })
      )
      .setIn(
        ['a', 'geoip'],
        fromJS({ country: 'US', city: 'Mountain View', ll: [37.4, -122.1] })
      )
      .setIn(
        ['a', 'language'],
        fromJS([{ code: 'en', region: 'US', quality: 1 }])
      );

    const agg2 = new Aggregator();
    agg2.load(agg.dump());

    const entry = agg2.entries.get('a');
    assert.strictEqual(entry.get('identity'), 'Googlebot');
    assert.strictEqual(entry.getIn(['address', 'hostname']), 'bot.google.com');
    assert.strictEqual(entry.getIn(['agent', 'os']).get('family'), 'Other');
    assert.strictEqual(entry.getIn(['geoip', 'country']), 'US');
    assert.strictEqual(entry.getIn(['language', 0, 'code']), 'en');
  });

  it('restores signature.headers as a plain object', () => {
    const agg = new Aggregator();
    const t = now();

    const headers = { Accept: 'text/html', 'User-Agent': 'Bot/1.0' };
    agg.entries = agg.entries
      .setIn(['a', 'id'], 'a')
      .setIn(['a', 'identifier'], 'sig-abc')
      .setIn(['a', 'speed', 'per_minute'], new Speed(60, 15).hit(t))
      .setIn(['a', 'speed', 'per_hour'], new Speed(3600, 24).hit(t))
      .setIn(['a', 'signature'], Map({ id: 'abc', headers }));

    const agg2 = new Aggregator();
    agg2.load(agg.dump());

    const restored = agg2.entries.getIn(['a', 'signature', 'headers']);
    assert.strictEqual(typeof restored, 'object');
    assert.ok(!restored.toJS, 'headers should not be an Immutable Map');
    assert.deepStrictEqual(Object.entries(restored), [
      ['Accept', 'text/html'],
      ['User-Agent', 'Bot/1.0'],
    ]);
  });

  it('restores addresses as an Immutable Set', () => {
    const agg = new Aggregator();
    const t = now();

    agg.entries = agg.entries
      .setIn(['a', 'id'], 'a')
      .setIn(['a', 'identifier'], 'sig-abc')
      .setIn(['a', 'speed', 'per_minute'], new Speed(60, 15).hit(t))
      .setIn(['a', 'speed', 'per_hour'], new Speed(3600, 24).hit(t))
      .set(
        'a',
        agg.entries.get('a', Map()).merge(
          Map({
            id: 'a',
            identifier: 'sig-abc',
            addresses: Set([
              Map({ value: '1.2.3.4' }),
              Map({ value: '5.6.7.8' }),
            ]),
          })
        )
      )
      .setIn(['a', 'speed', 'per_minute'], new Speed(60, 15).hit(t))
      .setIn(['a', 'speed', 'per_hour'], new Speed(3600, 24).hit(t));

    const agg2 = new Aggregator();
    agg2.load(agg.dump());

    const addresses = agg2.entries.getIn(['a', 'addresses']);
    assert.ok(Set.isSet(addresses), 'addresses should be an Immutable Set');
    assert.strictEqual(addresses.size, 2);
    // Set.add should work (this is what signature enricher does)
    const updated = addresses.add(Map({ value: '9.9.9.9' }));
    assert.strictEqual(updated.size, 3);
  });

  it('loaded entries accept new hits from processLog', () => {
    const { md5 } = require('../../src/lib/util');

    const agg = new Aggregator();
    const t = now();
    const identifier = '1.2.3.4';
    const id = md5(identifier);

    agg.entries = agg.entries
      .setIn([id, 'id'], id)
      .setIn([id, 'identifier'], identifier)
      .setIn([id, 'speed', 'per_minute'], new Speed(60, 15).hit(t, 10))
      .setIn([id, 'speed', 'per_hour'], new Speed(3600, 24).hit(t, 10));

    const agg2 = new Aggregator();
    agg2.load(agg.dump());

    // processLog with matching identifier should update existing entry
    agg2.setIdentifier((log) => log.getIn(['address', 'value']));
    const log = fromJS({
      request: { address: '1.2.3.4' },
      address: { value: '1.2.3.4' },
      executionTime: 25,
    });
    agg2.processLog(log);

    const pm = agg2.entries.getIn([id, 'speed', 'per_minute']);
    // Should now have 2 hits
    assert.strictEqual(
      pm.compute().reduce((a, b) => a + b, 0),
      2
    );
  });
});

describe('persistence dump / load', () => {
  let tmpDir;
  const persistence = require('../../src/lib/persistence');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperwatch-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads JSON files per aggregator', () => {
    const agg = new Aggregator();
    const t = now();
    agg.entries = agg.entries
      .setIn(['x', 'id'], 'x')
      .setIn(['x', 'identifier'], '10.0.0.1')
      .setIn(['x', 'speed', 'per_minute'], new Speed(60, 15).hit(t))
      .setIn(['x', 'speed', 'per_hour'], new Speed(3600, 24).hit(t));

    persistence.register('test-agg', agg);

    persistence.dump(tmpDir);
    assert.ok(fs.existsSync(path.join(tmpDir, 'test-agg.json')));

    // Create a fresh aggregator and load
    const agg2 = new Aggregator();
    persistence.register('test-agg', agg2);
    persistence.load(tmpDir);

    assert.strictEqual(agg2.entries.size, 1);
    assert.strictEqual(agg2.entries.getIn(['x', 'identifier']), '10.0.0.1');
  });

  it('skips load when directory does not exist', () => {
    persistence.load(path.join(tmpDir, 'nonexistent'));
    // Should not throw
  });
});
