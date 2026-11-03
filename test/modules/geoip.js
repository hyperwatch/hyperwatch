const assert = require('assert');

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
