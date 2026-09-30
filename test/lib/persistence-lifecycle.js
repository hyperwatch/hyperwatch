const assert = require('assert');

const { Persistence, normalize } = require('../../src/lib/persistence');
const { parseBoolean } = require('../../src/lib/util');
const { createMemoryStorage } = require('../helpers/memory-storage');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A document whose dump() returns `state` and load() records what it got
function doc(state = []) {
  return {
    state,
    loaded: null,
    dump() {
      return this.state;
    },
    load(data) {
      this.loaded = data;
    },
  };
}

// A promise and the function resolving it
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('persistence lifecycle', () => {
  let logs;
  let errors;
  let original;

  beforeEach(() => {
    logs = [];
    errors = [];
    original = { log: console.log, error: console.error };
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => errors.push(args.join(' '));
  });

  afterEach(() => {
    console.log = original.log;
    console.error = original.error;
  });

  describe('metrics', () => {
    it('reports the stages, sizes and totals of a load and a dump', async () => {
      const storage = createMemoryStorage();
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('small', doc([1]));
      persistence.register('large', doc([{ a: 'x'.repeat(100) }]));

      const dumped = await persistence.dump();
      assert.strictEqual(dumped.backend, 'memory');
      assert.strictEqual(dumped.documents, 2);
      assert.strictEqual(
        dumped.bytes,
        storage.documents.get('small').length +
          storage.documents.get('large').length
      );
      assert.strictEqual(dumped.largest, storage.documents.get('large').length);
      assert.deepStrictEqual(Object.keys(dumped.stages), [
        'serialize',
        'store',
      ]);
      assert.strictEqual(typeof dumped.total, 'number');

      const loaded = await persistence.load();
      assert.strictEqual(loaded.documents, 2);
      assert.strictEqual(loaded.bytes, dumped.bytes);
      assert.deepStrictEqual(Object.keys(loaded.stages), [
        'fetch',
        'parse',
        'restore',
      ]);

      assert.match(
        logs[0],
        /^Persistence \(memory\) dumped 2 documents \(\d+ B\) in [\d.]+s: serialize [\d.]+s, store [\d.]+s$/
      );
      assert.match(
        logs[1],
        /^Persistence \(memory\) loaded 2 documents \(\d+ B\) in [\d.]+s: fetch [\d.]+s, parse [\d.]+s, restore [\d.]+s$/
      );
      assert.deepStrictEqual(persistence.latest, {
        load: loaded,
        dump: dumped,
      });
    });

    it('shows the latest load and dump on /status', async () => {
      const persistence = new Persistence();
      persistence.setStorage(createMemoryStorage());
      persistence.register('doc', doc([1]));

      await persistence.start({});
      assert.strictEqual(persistence.monitor.name, 'persistence (memory)');
      assert.strictEqual(persistence.monitor.type, 'persistence');
      assert.match(
        persistence.monitor.status,
        /^\(memory\) loaded 0 documents/
      );
      assert.match(persistence.monitor.status, /1 missing at \d{4}-/);

      await persistence.stop({});
      assert.match(
        persistence.monitor.status,
        /; \(memory\) dumped 1 document /
      );
      assert.strictEqual(persistence.monitor.persistence.dump.documents, 1);
      assert.strictEqual(persistence.monitor.persistence.load.missing, 1);
    });
  });

  describe('restore', () => {
    it('keeps what loaded when a document fails', async () => {
      const storage = createMemoryStorage();
      storage.documents.set('good', '[1,2]');
      storage.documents.set('broken', '[1,');
      storage.documents.set('object', '{}');
      const persistence = new Persistence();
      persistence.setStorage(storage);
      const good = doc();
      persistence.register('good', good);
      persistence.register('broken', doc());
      persistence.register('object', doc());
      persistence.register('missing', doc());

      const result = await persistence.load();

      assert.deepStrictEqual(good.loaded, [1, 2]);
      assert.strictEqual(result.documents, 1);
      assert.strictEqual(result.failed, 2);
      assert.strictEqual(result.missing, 1);
      assert.strictEqual(errors.length, 2);
      assert.match(logs[0], /2 failed/);
    });

    it("doesn't wait past the deadline for a stalled read", async () => {
      const storage = createMemoryStorage();
      storage.documents.set('fast', '[1]');
      const read = storage.read;
      storage.read = (name, options) =>
        name === 'stalled' ? new Promise(() => {}) : read(name, options);
      const persistence = new Persistence();
      persistence.setStorage(storage);
      const fast = doc();
      persistence.register('fast', fast);
      persistence.register('stalled', doc());

      const started = Date.now();
      const result = await persistence.load({
        signal: AbortSignal.timeout(50),
      });

      assert.ok(Date.now() - started < 1000);
      assert.deepStrictEqual(fast.loaded, [1]);
      assert.strictEqual(result.timedOut, true);
      assert.strictEqual(result.failed, 0);
      assert.match(logs[0], /deadline passed/);
    });
  });

  describe('dump', () => {
    it("doesn't let a write timed out earlier overwrite a newer snapshot", async () => {
      const storage = createMemoryStorage();
      const release = deferred();
      let calls = 0;
      // The first write ignores the signal and lands after its deadline
      storage.write = async (name, body) => {
        calls++;
        if (calls === 1) {
          await release.promise;
        }
        storage.documents.set(name, body);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      const target = doc(['old']);
      persistence.register('doc', target);

      const first = await persistence.dump({ signal: AbortSignal.timeout(20) });
      assert.strictEqual(first.timedOut, true);

      target.state = ['new'];
      const second = persistence.dump();
      await sleep(20);
      // The newer write waits for the older one
      assert.strictEqual(calls, 1);
      release.resolve();
      await second;

      assert.strictEqual(storage.documents.get('doc'), '["new"]');
    });

    it('never runs two dumps at the same time', async () => {
      const storage = createMemoryStorage();
      let running = 0;
      let max = 0;
      const write = storage.write;
      storage.write = async (...args) => {
        running++;
        max = Math.max(max, running);
        await sleep(10);
        running--;
        return write(...args);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc([1]));

      await Promise.all([persistence.dump(), persistence.dump()]);
      assert.strictEqual(max, 1);
    });
  });

  describe('stop', () => {
    it('waits for the dump in progress, then saves the latest state', async () => {
      const storage = createMemoryStorage();
      const release = deferred();
      const writes = [];
      storage.write = async (name, body) => {
        writes.push(body);
        if (writes.length === 1) {
          await release.promise;
        }
        storage.documents.set(name, body);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      const target = doc(['periodic']);
      persistence.register('doc', target);

      const periodic = persistence.dump();
      await sleep(5);
      target.state = ['final'];
      const stopped = persistence.stop({});
      await sleep(5);
      assert.deepStrictEqual(writes, ['["periodic"]']);

      release.resolve();
      await Promise.all([periodic, stopped]);
      assert.deepStrictEqual(writes, ['["periodic"]', '["final"]']);
      assert.strictEqual(storage.documents.get('doc'), '["final"]');
    });

    it('closes the storage even when dumping fails', async () => {
      const storage = createMemoryStorage();
      let closed = false;
      storage.write = async () => {
        throw new Error('storage down');
      };
      storage.close = async () => {
        closed = true;
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc([1]));

      await persistence.stop({});
      assert.ok(closed);
      assert.match(errors[0], /skipping doc: storage down/);
      assert.match(logs[0], /dumped 0 documents .*1 failed/);
    });

    it('waits for the restore in progress before dumping', async () => {
      const storage = createMemoryStorage();
      storage.documents.set('doc', '["stored"]');
      const release = deferred();
      const read = storage.read;
      storage.read = async (...args) => {
        await release.promise;
        return read(...args);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      const target = doc();
      target.load = function (data) {
        this.state = data;
      };
      persistence.register('doc', target);

      const started = persistence.start({ interval: 60 });
      const stopped = persistence.stop({});
      await sleep(5);
      assert.strictEqual(storage.documents.get('doc'), '["stored"]');

      release.resolve();
      await Promise.all([started, stopped]);
      assert.strictEqual(storage.documents.get('doc'), '["stored"]');
      assert.match(logs[1], /dumped 1 document /);
      // No snapshots after stopping
      assert.strictEqual(persistence.timer, null);
    });

    it("doesn't dump when the restore outlasts the stop deadline", async () => {
      const storage = createMemoryStorage();
      storage.documents.set('doc', '["stored"]');
      storage.read = () => new Promise(() => {});
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc(['partial']));
      const warn = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));

      try {
        persistence.start({ deadlines: { load: 60 } });
        await persistence.stop({ deadlines: { stop: 0.05 } });
      } finally {
        console.warn = warn;
      }
      assert.strictEqual(storage.documents.get('doc'), '["stored"]');
      assert.match(warnings[0], /not dumping/);
    });

    it("isn't blocked by a stalled storage", async () => {
      const storage = createMemoryStorage();
      storage.write = () => new Promise(() => {});
      storage.close = () => new Promise(() => {});
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc([1]));

      const started = Date.now();
      await persistence.stop({ deadlines: { stop: 0.05 } });
      assert.ok(Date.now() - started < 1000);
      assert.match(logs[0], /deadline passed/);
      assert.match(errors[0], /Error closing the persistence storage/);
    });
  });

  describe('periodic snapshots', () => {
    it('dumps every interval until stopped', async () => {
      const storage = createMemoryStorage();
      let writes = 0;
      const write = storage.write;
      storage.write = (...args) => {
        writes++;
        return write(...args);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc([1]));

      await persistence.start({ interval: 0.02 });
      await sleep(90);
      persistence.stopSnapshots();
      const count = writes;
      assert.ok(count >= 2, `expected 2 snapshots or more, got ${count}`);
      await sleep(50);
      assert.strictEqual(writes, count);
    });

    it("don't start when stopped during the restore", async () => {
      const storage = createMemoryStorage();
      const release = deferred();
      const read = storage.read;
      storage.read = async (...args) => {
        await release.promise;
        return read(...args);
      };
      const persistence = new Persistence();
      persistence.setStorage(storage);
      persistence.register('doc', doc([1]));

      const started = persistence.start({ interval: 60 });
      // What hyperwatch.stop() does before stopping the inputs
      persistence.stopSnapshots();
      release.resolve();
      await started;
      assert.strictEqual(persistence.timer, null);
      assert.strictEqual(persistence.snapshots, false);
    });

    it('are off without an interval', async () => {
      const persistence = new Persistence();
      persistence.setStorage(createMemoryStorage());
      await persistence.start({});
      assert.strictEqual(persistence.timer, null);
    });
  });
});

describe('persistence configuration', () => {
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

  it('parses pseudo-booleans', () => {
    for (const value of [true, 1, 'true', '1', ' TRUE ']) {
      assert.strictEqual(parseBoolean(value), true, String(value));
    }
    for (const value of [false, 0, 'false', '0', '', 'yes', null, undefined]) {
      assert.strictEqual(parseBoolean(value), false, String(value));
    }
  });

  it('reads enabled from environment strings', () => {
    assert.strictEqual(normalize({ enabled: 'false' }).enabled, false);
    assert.strictEqual(normalize({ enabled: '0' }).enabled, false);
    assert.strictEqual(normalize({ enabled: '1' }).enabled, true);
    assert.strictEqual(normalize({ enabled: true }).enabled, true);
  });

  it('reads the interval as a number of seconds', () => {
    assert.strictEqual(normalize({ interval: '300' }).interval, 300);
    assert.strictEqual(normalize({ interval: null }).interval, null);
    assert.deepStrictEqual(warnings, []);
  });

  it('turns snapshots off for an invalid interval, with a warning', () => {
    assert.strictEqual(normalize({ interval: 'soon' }).interval, null);
    assert.strictEqual(normalize({ interval: -5 }).interval, null);
    assert.strictEqual(warnings.length, 2);
  });

  it('only accepts durations timers support', async () => {
    for (const value of [Infinity, '1e16', 3e6, 0.0004]) {
      assert.strictEqual(normalize({ interval: value }).interval, null);
      assert.strictEqual(
        normalize({ deadlines: { stop: value } }).deadlines.stop,
        20
      );
    }
    assert.strictEqual(warnings.length, 8);
    assert.strictEqual(normalize({ interval: 2e6 }).interval, 2e6);
    assert.strictEqual(normalize({ interval: 0.001 }).interval, 0.001);
    // Rounded to whole milliseconds for the timers
    for (const stop of [0.0015, 0.07]) {
      const { deadlines } = normalize({ deadlines: { stop } });
      assert.strictEqual(deadlines.stop, stop);
      const persistence = new Persistence();
      persistence.setStorage(createMemoryStorage());
      // Would throw ERR_OUT_OF_RANGE without the rounding
      await persistence.stop({ deadlines });
    }
  });

  it('fills the deadlines', () => {
    assert.deepStrictEqual(normalize({}).deadlines, {
      load: 60,
      dump: 60,
      stop: 20,
    });
    assert.deepStrictEqual(
      normalize({ deadlines: { stop: '25', load: 'x' } }).deadlines,
      { load: 60, dump: 60, stop: 25 }
    );
    assert.strictEqual(warnings.length, 1);
  });

  it('fails on an unknown backend when enabled', () => {
    assert.throws(
      () => normalize({ enabled: true, backend: 'S3' }),
      /Unknown persistence backend "S3" \(available: file\)/
    );
    assert.strictEqual(
      normalize({ enabled: false, backend: 'S3' }).backend,
      'S3'
    );
    assert.strictEqual(normalize({ enabled: true }).backend, 'file');
  });
});
