const assert = require('assert');
const http = require('http');

const { fromJS } = require('immutable');

const api = require('../../src/app/api');
const { memoryReport } = require('../../src/app/memory');
const { Aggregator } = require('../../src/lib/aggregator');
const LogBuffer = require('../../src/lib/log-buffer');
const { Persistence } = require('../../src/lib/persistence');
const { createMemoryStorage } = require('../helpers/memory-storage');

const log = (fields) => fromJS({ executionTime: 10, ...fields });

describe('memoryReport', () => {
  let logs;
  let original;

  beforeEach(() => {
    // The persistence logs each load and dump
    logs = [];
    original = console.log;
    console.log = (...args) => logs.push(args.join(' '));
  });

  afterEach(() => {
    console.log = original;
  });

  function setup() {
    const persistence = new Persistence();
    persistence.setStorage(createMemoryStorage());

    const aggregator = new Aggregator();
    aggregator.setIdentifier((entry) => entry.get('key'));
    ['a', 'b', 'c'].forEach((key) => aggregator.processLog(log({ key })));
    aggregator.sorters.extra = () => 0;
    aggregator.gcSize = 50;
    persistence.register('things', aggregator);

    const buffer = new LogBuffer(10);
    buffer.push(log({ key: 'a' }));
    buffer.push(log({ key: 'b' }));
    persistence.register('history-main', buffer);

    persistence.register('custom', { dump: () => [], load() {} });

    return { persistence, aggregator };
  }

  it('reports the process, the heap and its spaces', () => {
    const report = memoryReport({ persistence: new Persistence() });

    assert.ok(report.process.rss > 0);
    assert.ok(report.process.heapUsed > 0);
    assert.ok(report.heap.limit >= report.heap.total);
    assert.ok(report.heap.used > 0);
    assert.ok(report.heapSpaces.some((space) => space.name === 'old_space'));
    assert.deepStrictEqual(report.documents, []);
  });

  it('reports each document: entries, ceiling of aggregators, capacity of history', () => {
    const { persistence } = setup();
    const byName = Object.fromEntries(
      memoryReport({ persistence }).documents.map((d) => [d.name, d])
    );

    // The default sorters and one more
    const sorters = Object.keys(new Aggregator().sorters).length + 1;
    assert.deepStrictEqual(byName.things, {
      name: 'things',
      type: 'aggregator',
      entries: 3,
      gcSize: 50,
      sorters,
      ceiling: 50 * sorters,
      loadedBytes: null,
      dumpedBytes: null,
    });
    assert.deepStrictEqual(byName['history-main'], {
      name: 'history-main',
      type: 'history',
      entries: 2,
      capacity: 10,
      loadedBytes: null,
      dumpedBytes: null,
    });
    assert.deepStrictEqual(byName.custom, {
      name: 'custom',
      type: 'other',
      loadedBytes: null,
      dumpedBytes: null,
    });
  });

  it('gives the bytes of the latest load and dump, heaviest first', async () => {
    const { persistence } = setup();
    await persistence.dump();
    await persistence.load();

    const { documents } = memoryReport({ persistence });
    assert.deepStrictEqual(
      documents.map((d) => d.name),
      ['things', 'history-main', 'custom']
    );
    for (const document of documents) {
      assert.ok(document.dumpedBytes > 0, document.name);
      assert.strictEqual(document.loadedBytes, document.dumpedBytes);
    }
    assert.strictEqual(documents[2].dumpedBytes, 2); // "[]"
  });

  it('measures the documents now only when asked', () => {
    const { persistence, aggregator } = setup();

    const before = memoryReport({ persistence }).documents;
    assert.ok(before.every((d) => d.bytes === undefined));

    const measured = memoryReport({ persistence, measure: true }).documents;
    const things = measured.find((d) => d.name === 'things');
    assert.strictEqual(
      things.bytes,
      Buffer.byteLength(JSON.stringify(aggregator.dump()))
    );
  });
});

describe('GET /memory.json', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(api);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('answers with the report, measured with ?measure=1', async () => {
    const res = await fetch(`${baseUrl}/memory.json`);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.process.rss > 0);
    assert.ok(Array.isArray(body.documents));
    assert.ok(body.documents.every((d) => d.bytes === undefined));

    const measured = await (
      await fetch(`${baseUrl}/memory.json?measure=1`)
    ).json();
    assert.ok(measured.documents.every((d) => typeof d.bytes === 'number'));
  });
});
