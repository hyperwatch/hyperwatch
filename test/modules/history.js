const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { fromJS } = require('immutable');

const api = require('../../src/app/api');
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

  it('keeps 100 logs per node by default', () => {
    assert.strictEqual(capacityFor('main'), 100);
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
    const config = { nodes: { 'graphql-*': 200, 'graphql-slow*': 500 } };
    assert.strictEqual(capacityFor('graphql-slow', config), 200);
    assert.strictEqual(capacityFor('graphql', config), 100);
  });

  it('reads environment strings, and warns about invalid values', () => {
    assert.strictEqual(capacityFor('raw', { nodes: { raw: '0' } }), 0);
    assert.strictEqual(capacityFor('main', { capacity: '250' }), 250);
    assert.strictEqual(capacityFor('main', { capacity: 'lots' }), 100);
    assert.strictEqual(
      capacityFor('raw', { capacity: 300, nodes: { raw: -1 } }),
      300
    );
    assert.strictEqual(capacityFor('raw', { nodes: { raw: 1.5 } }), 100);
    assert.strictEqual(warnings.length, 3);
  });

  it("doesn't read non-numeric values as 0", () => {
    for (const raw of [false, true, ' ', [], [0], [20], '0x10', '1e2']) {
      assert.strictEqual(
        capacityFor('raw', { capacity: 300, nodes: { raw } }),
        300,
        JSON.stringify(raw)
      );
    }
    assert.strictEqual(warnings.length, 8);
    assert.strictEqual(capacityFor('raw', { nodes: { raw: ' 20 ' } }), 20);
  });

  it('rejects capacities longer than an array can be', () => {
    assert.strictEqual(
      capacityFor('raw', { capacity: 2 ** 32 - 1 }),
      2 ** 32 - 1
    );
    assert.strictEqual(capacityFor('raw', { capacity: 2 ** 32 }), 100);
    assert.strictEqual(capacityFor('raw', { capacity: '4294967296' }), 100);
    assert.strictEqual(warnings.length, 2);
  });
});

describe('history per node', () => {
  // Pipeline properties to restore
  const original = {};
  let config;
  let send;

  before(() => {
    config = constants.modules.history;
    original.nodes = pipeline.nodes;
    original.registerNode = pipeline.registerNode;
    // Only this test's nodes and input in the pipeline
    original.children = pipeline.children;
    original.inputs = pipeline.inputs;
    original.monitors = pipeline.monitors;
    pipeline.children = [];
    pipeline.inputs = [];
    pipeline.monitors = [];

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

    pipeline.registerInput({
      name: 'history-test',
      start: (handlers) => {
        send = handlers.success;
      },
    });
    pipeline.start();
  });

  after(async () => {
    await pipeline.stop();
    Object.assign(pipeline, original);
    constants.modules.history = config;
  });

  const log = (url) =>
    fromJS({
      request: {
        time: new Date().toISOString(),
        address: '10.0.0.1',
        method: 'GET',
        url,
        headers: {},
      },
      response: { status: 200 },
    });

  const urls = (name) =>
    history.latest(name, 10, {}).map((l) => l.getIn(['request', 'url']));

  it('only keeps and persists history for nodes with a capacity', () => {
    assert.ok(persistence.documents['history-test-kept']);
    assert.strictEqual(persistence.documents['history-test-off'], undefined);
    assert.strictEqual(
      persistence.documents['history-test-input-1'],
      undefined
    );
  });

  it('keeps the latest logs going through each node, up to its capacity', () => {
    for (const url of ['/a', '/b', '/c']) {
      send(log(url));
    }
    assert.deepStrictEqual(urls('test-kept'), ['/c', '/b']);
    assert.deepStrictEqual(urls('test-off'), []);
    assert.deepStrictEqual(urls('test-input-1'), []);
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

describe('history of a node turned off, then on again', () => {
  const { Persistence } = require('../../src/lib/persistence');
  const LogBuffer = require('../../src/lib/log-buffer');
  const { createMemoryStorage } = require('../helpers/memory-storage');

  // One run of an instance: registers the node's history like history.js
  // does (nothing when its capacity is 0), restores, then dumps
  async function run(storage, capacity, logs = []) {
    const instance = new Persistence();
    instance.setStorage(storage);
    let buffer = null;
    if (history.capacityFor('node', { nodes: { node: capacity } })) {
      buffer = new LogBuffer(capacity);
      instance.register('history-node', buffer);
    }
    await instance.load();
    for (const id of logs) {
      buffer.push(fromJS({ id }));
    }
    await instance.dump();
    return buffer;
  }

  let log;

  beforeEach(() => {
    log = console.log;
    console.log = () => {};
  });

  afterEach(() => {
    console.log = log;
  });

  it('keeps the document saved before, and restores it when turned on', async () => {
    const storage = createMemoryStorage();
    await run(storage, 10, ['a', 'b']);

    // Turned off: the document is neither read, written nor deleted
    assert.strictEqual(await run(storage, 0), null);
    assert.ok(storage.documents.has('history-node'));

    // Turned on again: the earlier logs come back
    const buffer = await run(storage, 10);
    assert.deepStrictEqual(
      buffer.toArray().map((l) => l.get('id')),
      ['b', 'a']
    );
  });
});

describe('history disk directory', () => {
  const { diskDirFor } = history;
  const disk = (nodes, dir = '/data/logs') => ({ disk: { dir, nodes } });

  it('is off unless set for the node', () => {
    assert.strictEqual(diskDirFor('main'), null);
    assert.strictEqual(diskDirFor('main', { disk: {} }), null);
    assert.strictEqual(diskDirFor('main', disk({ other: true })), null);
    assert.strictEqual(diskDirFor('main', disk({ main: false })), null);
    assert.strictEqual(diskDirFor('main', disk({ main: 'false' })), null);
  });

  it('takes node names and patterns, from the rc too', () => {
    assert.strictEqual(
      diskDirFor('main', disk({ main: true })),
      '/data/logs/node-main'
    );
    assert.strictEqual(
      diskDirFor('input-1', disk({ 'input-*': 'true' })),
      '/data/logs/node-input-1'
    );
  });

  it('keeps every node inside the directory', () => {
    for (const name of ['..', '.', '../x', 'a/b']) {
      const dir = diskDirFor(name, disk({ [name]: true }));
      assert.strictEqual(path.dirname(dir), '/data/logs', name);
    }
  });

  it('defaults to .hyperwatch-data/logs', () => {
    assert.strictEqual(
      diskDirFor('main', { disk: { nodes: { main: true } } }),
      path.resolve('.hyperwatch-data', 'logs', 'node-main')
    );
  });
});

describe('history on disk', () => {
  const original = {};
  let config;
  let send;
  let server;
  let baseUrl;
  let dir;

  before(async () => {
    config = constants.modules.history;
    original.nodes = pipeline.nodes;
    original.registerNode = pipeline.registerNode;
    original.children = pipeline.children;
    original.inputs = pipeline.inputs;
    original.monitors = pipeline.monitors;
    pipeline.children = [];
    pipeline.inputs = [];
    pipeline.monitors = [];

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-disk-'));
    constants.modules.history = {
      active: true,
      capacity: 0,
      disk: {
        dir,
        nodes: { 'test-disk': true },
        restore: (log) => log.set('restored', true),
      },
    };
    pipeline.nodes = {
      'test-disk': pipeline.getNode('raw').filter(() => true, 'test-disk'),
    };
    history.start();

    pipeline.registerInput({
      name: 'history-disk-test',
      start: (handlers) => {
        send = handlers.success;
      },
    });
    pipeline.start();

    server = http.createServer(api);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pipeline.stop();
    await history.flush();
    Object.assign(pipeline, original);
    constants.modules.history = config;
  });

  const log = (url, address = '10.0.0.1') =>
    fromJS({
      request: {
        time: new Date().toISOString(),
        address,
        method: 'GET',
        url,
        headers: {},
      },
      response: { status: 200 },
    });

  const get = async (url) => {
    const res = await fetch(`${baseUrl}${url}`);
    return { status: res.status, body: await res.json() };
  };

  // Written once the stream wrote them
  const written = async (count) => {
    for (let i = 0; i < 100; i++) {
      const { body } = await get('/history/disk.json');
      if (body['test-disk'].written >= count) {
        return body['test-disk'];
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Logs not written');
  };

  it('writes logs of nodes set for disk, even without a memory history', async () => {
    send(log('/a'));
    send(log('/b', '10.0.0.2'));
    send(log('/c'));
    const stats = await written(3);
    assert.strictEqual(stats.files, 1);
    assert.strictEqual(stats.dropped, 0);
    assert.deepStrictEqual(history.latest('test-disk', 10, {}), []);
  });

  it('reads them back, newest first, filtered and paged', async () => {
    const urls = (body) => body.logs.map((l) => l.request.url);

    const all = await get('/history/test-disk/disk.json');
    assert.strictEqual(all.status, 200);
    assert.deepStrictEqual(urls(all.body), ['/c', '/b', '/a']);
    assert.strictEqual(all.body.cursor, null);

    const filtered = await get(
      '/history/test-disk/disk.json?address=10.0.0.1&limit=1'
    );
    assert.deepStrictEqual(urls(filtered.body), ['/c']);
    const next = await get(
      `/history/test-disk/disk.json?address=10.0.0.1&limit=1&cursor=${encodeURIComponent(filtered.body.cursor)}`
    );
    assert.deepStrictEqual(urls(next.body), ['/a']);
  });

  it('starts filtered views with the logs on disk, restored', async () => {
    const { body } = await get('/history/test-disk.json?address=10.0.0.1');
    assert.deepStrictEqual(
      body.map((l) => l.request.url),
      ['/c', '/a']
    );
    assert.ok(body.every((l) => l.restored));
    // Unfiltered: memory, empty here (capacity 0)
    assert.deepStrictEqual((await get('/history/test-disk.json')).body, []);
  });

  it('rejects an invalid limit or cursor', async () => {
    for (const query of ['limit=0', 'limit=1001', 'limit=x', 'cursor=nope']) {
      const { status } = await get(`/history/test-disk/disk.json?${query}`);
      assert.strictEqual(status, 400, query);
    }
  });

  it('only serves nodes with disk history', async () => {
    const res = await fetch(`${baseUrl}/history/main/disk.json`);
    assert.strictEqual(res.status, 404);
  });
});
