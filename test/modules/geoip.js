const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const { fromJS } = require('immutable');

const constants = require('../../src/constants');
const pipeline = require('../../src/lib/pipeline');
const geoip = require('../../src/modules/geoip');

describe('geoip fields', () => {
  const { fieldsFor } = geoip;
  let warn;
  let warnings;

  beforeEach(() => {
    warnings = [];
    warn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    console.warn = warn;
  });

  it('keeps country, region and city by default', () => {
    assert.deepStrictEqual(fieldsFor(), ['country', 'region', 'city']);
    assert.deepStrictEqual(fieldsFor({}), ['country', 'region', 'city']);
  });

  it('keeps everything with "all", or the fields listed', () => {
    assert.strictEqual(fieldsFor({ fields: 'all' }), null);
    assert.deepStrictEqual(fieldsFor({ fields: ['country', 'll'] }), [
      'country',
      'll',
    ]);
    // From the environment
    assert.deepStrictEqual(fieldsFor({ fields: 'country, timezone' }), [
      'country',
      'timezone',
    ]);
    assert.strictEqual(warnings.length, 0);
  });

  it('warns about invalid values', () => {
    assert.deepStrictEqual(fieldsFor({ fields: 3 }), [
      'country',
      'region',
      'city',
    ]);
    assert.deepStrictEqual(fieldsFor({ fields: [1] }), [
      'country',
      'region',
      'city',
    ]);
    assert.strictEqual(warnings.length, 2);
  });
});

describe('geoip augment', () => {
  let config;
  let nodes;

  before(() => {
    config = constants.modules.geoip;
    nodes = pipeline.nodes;
  });

  after(() => {
    constants.modules.geoip = config;
    pipeline.nodes = nodes;
  });

  const augmented = (fields) => {
    constants.modules.geoip = { ...config, fields };
    // init() reads the setting (and registers main, kept apart here)
    pipeline.nodes = { ...nodes };
    geoip.init();
    return geoip
      .augment(fromJS({ request: { address: '8.8.8.8' } }))
      .get('geoip')
      .toJS();
  };

  it('keeps the fields set', () => {
    assert.deepStrictEqual(Object.keys(augmented(undefined)).sort(), [
      'city',
      'country',
      'region',
    ]);
    assert.strictEqual(augmented(undefined).country, 'US');
    assert.ok(augmented('all').ll);
    assert.deepStrictEqual(Object.keys(augmented(['country', 'timezone'])), [
      'country',
      'timezone',
    ]);
  });
});

describe('geoip tables', () => {
  it('needs the city tables for fields other than country and range', () => {
    const { needsCities } = geoip;
    assert.strictEqual(needsCities(['country']), false);
    assert.strictEqual(needsCities(['country', 'range']), false);
    assert.strictEqual(needsCities(['country', 'region', 'city']), true);
    assert.strictEqual(needsCities(['country', 'timezone']), true);
    assert.strictEqual(needsCities(null), true);
  });

  // In another process: geoip-lite reads its tables once, when required
  const load = (fields) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '-e',
          `
          const constants = require('./src/constants');
          constants.modules.geoip = { fields: ${JSON.stringify(fields)} };
          const before = process.memoryUsage().external;
          const geoip = require('./src/modules/geoip');
          geoip.init();
          console.log(JSON.stringify({
            external: process.memoryUsage().external - before,
            v4: geoip.lookup('81.2.69.142'),
            v6: geoip.lookup('2001:4860:4860::8888'),
          }));
          `,
        ],
        { cwd: path.join(__dirname, '../..'), encoding: 'utf8' }
      )
    );

  it('loads the country tables only when fields allow', () => {
    const { external, v4, v6 } = load(['country']);
    assert.strictEqual(v4.country, 'GB');
    assert.strictEqual(v4.city, '');
    assert.strictEqual(v6.country, 'US');
    assert.ok(external < 20e6, `${external} bytes`);
  });

  it('loads the city tables for other fields', () => {
    const { external, v4 } = load(['country', 'city']);
    assert.strictEqual(v4.country, 'GB');
    assert.ok(v4.city);
    assert.ok(external > 50e6, `${external} bytes`);
  });
});
