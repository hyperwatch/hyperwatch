const assert = require('assert');

const { fromJS } = require('immutable');

const constants = require('../../src/constants');
const persistence = require('../../src/lib/persistence');
const pipeline = require('../../src/lib/pipeline');
const history = require('../../src/modules/history');

describe('history capacity', () => {
  const { capacityFor } = history;
  let warnings;
  let warn;

  beforeEach(() => {
    warnings = [];
    warn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
  });

  afterEach(() => {
    console.warn = warn;
  });

  it('keeps 1000 logs per node by default', () => {
    assert.strictEqual(capacityFor('main'), 1000);
    assert.strictEqual(capacityFor('main', { capacity: 300 }), 300);
  });

  it('takes a node setting, exact names before patterns', () => {
    const config = {
      capacity: 300,
      nodes: { 'input-*': 0, 'input-1': 50, main: 2000 },
    };
    assert.strictEqual(capacityFor('main', config), 2000);
    assert.strictEqual(capacityFor('input-1', config), 50);
    assert.strictEqual(capacityFor('input-2', config), 0);
    assert.strictEqual(capacityFor('raw', config), 300);
  });

  it('uses the first matching pattern', () => {
    const config = { nodes: { 'graphql-*': 100, 'graphql-slow*': 500 } };
    assert.strictEqual(capacityFor('graphql-slow', config), 100);
    assert.strictEqual(capacityFor('graphql', config), 1000);
  });

  it('reads environment strings, and warns about invalid values', () => {
    assert.strictEqual(capacityFor('raw', { nodes: { raw: '0' } }), 0);
    assert.strictEqual(capacityFor('main', { capacity: '250' }), 250);
    assert.strictEqual(capacityFor('main', { capacity: 'lots' }), 1000);
    assert.strictEqual(
      capacityFor('raw', { capacity: 300, nodes: { raw: -1 } }),
      300
    );
    assert.strictEqual(capacityFor('raw', { nodes: { raw: 1.5 } }), 1000);
    assert.strictEqual(warnings.length, 3);
  });
});

describe('history per node', () => {
  const original = {};

  before(() => {
    original.nodes = pipeline.nodes;
    original.registerNode = pipeline.registerNode;
    original.config = constants.modules.history;

    constants.modules.history = {
      active: true,
      capacity: 2,
      nodes: { 'test-off': 0, 'test-input-*': 0 },
    };
    const nodes = {};
    for (const name of ['test-kept', 'test-off', 'test-input-1']) {
      nodes[name] = pipeline.getNode('raw').filter(() => true, name);
    }
    pipeline.nodes = nodes;
    history.start();
  });

  after(() => {
    pipeline.nodes = original.nodes;
    pipeline.registerNode = original.registerNode;
    constants.modules.history = original.config;
  });

  it('only keeps and persists history for nodes with a capacity', () => {
    assert.ok(persistence.documents['history-test-kept']);
    assert.strictEqual(persistence.documents['history-test-off'], undefined);
    assert.strictEqual(
      persistence.documents['history-test-input-1'],
      undefined
    );
  });

  it('keeps the latest logs up to the capacity', () => {
    const buffer = persistence.documents['history-test-kept'];
    for (const id of ['a', 'b', 'c']) {
      buffer.push(fromJS({ id }));
    }
    assert.deepStrictEqual(
      history.latest('test-kept', 10, {}).map((log) => log.get('id')),
      ['c', 'b']
    );
    assert.deepStrictEqual(history.latest('test-off', 10, {}), []);
  });

  it('applies the settings to nodes registered later', () => {
    const node = pipeline.getNode('test-kept').filter(() => true, 'later');
    pipeline.registerNode('test-input-2', node);
    pipeline.registerNode('test-later', node);
    assert.strictEqual(
      persistence.documents['history-test-input-2'],
      undefined
    );
    assert.ok(persistence.documents['history-test-later']);
  });
});
