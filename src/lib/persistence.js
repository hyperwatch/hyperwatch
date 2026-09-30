/**
 * Save the registered aggregators and history buffers to a storage (see
 * ./storage) and restore them at startup. Snapshots are taken when
 * Hyperwatch stops and, with `interval`, periodically.
 *
 * Each instance writes complete snapshots and only reads them at startup: two
 * instances sharing a namespace would overwrite each other.
 */
const { performance } = require('perf_hooks');

const debug = require('debug');

const monitoring = require('./monitoring');
const storages = require('./storage');
const { parseBoolean } = require('./util');

const debugPersistence = debug('hyperwatch:persistence');

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// Documents read or written at the same time
const CONCURRENCY = 4;

// Seconds
const DEFAULT_DEADLINES = { load: 60, dump: 60, stop: 20 };

// Encode any string into a name accepted by register(). Characters outside
// [A-Za-z0-9.-], including '_' itself, become _<hex code point>_, so distinct
// inputs never map to the same name.
function safeName(name) {
  return String(name).replace(
    /[^A-Za-z0-9.-]/gu,
    (c) => `_${c.codePointAt(0).toString(16)}_`
  );
}

const isSet = (value) => value !== null && value !== undefined && value !== '';

// Longest delay Node timers support, in milliseconds (about 24.8 days):
// setTimeout() fires after 1 ms beyond it
const MAX_TIMER = 2 ** 31 - 1;

// Timers take whole milliseconds: AbortSignal.timeout() throws otherwise,
// e.g. for 0.07 * 1000 = 70.00000000000001
const toMs = (seconds) => Math.round(seconds * 1000);

// Seconds, as a number timers support, or null
const positive = (value) => {
  const ms = toMs(Number(value));
  return isSet(value) && ms >= 1 && ms <= MAX_TIMER ? Number(value) : null;
};

/**
 * Normalize the persistence constants in place. Values set through the
 * environment (rc) are strings, and "false" would be truthy.
 */
function normalize(config) {
  config.enabled = parseBoolean(config.enabled);

  const interval = positive(config.interval);
  if (interval === null && isSet(config.interval)) {
    console.warn(
      `Invalid persistence.interval "${config.interval}": periodic snapshots are off.`
    );
  }
  config.interval = interval;

  const deadlines = config.deadlines || {};
  config.deadlines = {};
  for (const [phase, fallback] of Object.entries(DEFAULT_DEADLINES)) {
    const value = positive(deadlines[phase]);
    if (value === null && isSet(deadlines[phase])) {
      console.warn(
        `Invalid persistence.deadlines.${phase} "${deadlines[phase]}": using ${fallback}.`
      );
    }
    config.deadlines[phase] = value || fallback;
  }

  config.backend = config.backend || 'file';
  if (config.enabled && !storages.backends[config.backend]) {
    throw new Error(
      `Unknown persistence backend "${config.backend}" (available: ${Object.keys(
        storages.backends
      ).join(', ')})`
    );
  }

  return config;
}

const deadline = (seconds) =>
  seconds ? AbortSignal.timeout(toMs(seconds)) : undefined;

// Settles with `promise`, or rejects as soon as `signal` aborts, so a stalled
// operation can't hold a phase past its deadline
function bounded(promise, signal) {
  if (!signal) {
    return promise;
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      promise.catch(() => {});
      reject(signal.reason);
      return;
    }
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

async function pool(items, worker) {
  const queue = [...items];
  const run = async () => {
    while (queue.length) {
      await worker(queue.shift());
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

const since = (start) => performance.now() - start;

function formatBytes(bytes) {
  if (bytes >= 1e6) {
    return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  }
  if (bytes >= 1e3) {
    return `${Math.round(bytes / 1e3)} kB`;
  }
  return `${bytes} B`;
}

const formatSeconds = (ms) => `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)}s`;

class Persistence {
  constructor() {
    this.documents = Object.create(null);
    this.storage = null;
    // Released when the dump in progress is over, see dump()
    this.queue = Promise.resolve();
    // Writes still running per document, even past their deadline
    this.pendingWrites = new Map();
    this.latest = { load: null, dump: null };
    this.monitor = null;
    this.timer = null;
    this.snapshots = false;
    // Aborts the periodic snapshot in progress
    this.snapshot = null;
    // Restoring at start, and whether it's over
    this.loading = null;
    this.loaded = false;
    this.stopping = false;
    // Aborts the restore in progress
    this.restore = null;
  }

  register(name, target) {
    if (!SAFE_NAME.test(name)) {
      throw new Error(`Invalid aggregator name for persistence: "${name}"`);
    }
    this.documents[name] = target;
  }

  // Like cache.setProvider(): replaces the backend selected by the constants
  setStorage(storage) {
    this.storage = storage;
  }

  getStorage() {
    return this.storage;
  }

  /**
   * Restore every registered document found in the storage. Missing and
   * failed documents are skipped, and what was restored is kept.
   */
  async load({ signal } = {}) {
    const started = performance.now();
    const stats = createStats(['fetch', 'parse', 'restore']);

    await pool(Object.keys(this.documents), async (name) => {
      if (signal && signal.aborted) {
        stats.timedOut = true;
        return;
      }

      let body;
      let start = performance.now();
      try {
        body = await bounded(
          Promise.resolve().then(() => this.storage.read(name, { signal })),
          signal
        );
      } catch (err) {
        failed(stats, name, err, signal);
        return;
      } finally {
        stats.stages.fetch += since(start);
      }
      if (body === null || body === undefined) {
        stats.missing++;
        return;
      }
      if (signal && signal.aborted) {
        stats.timedOut = true;
        return;
      }

      let data;
      start = performance.now();
      try {
        data = JSON.parse(body);
      } catch (err) {
        failed(stats, name, err);
        return;
      } finally {
        stats.stages.parse += since(start);
      }
      if (!Array.isArray(data)) {
        failed(stats, name, new Error(`expected array, got ${typeof data}`));
        return;
      }

      start = performance.now();
      try {
        this.documents[name].load(data);
      } catch (err) {
        failed(stats, name, err);
        return;
      } finally {
        stats.stages.restore += since(start);
      }
      counted(stats, Buffer.byteLength(body));
    });

    return this.record('load', stats, since(started));
  }

  /**
   * Save every registered document. Dumps never overlap: a dump first waits
   * for the one in progress, within its own deadline.
   */
  async dump({ signal } = {}) {
    const previous = this.queue;
    let release;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    try {
      try {
        await bounded(previous, signal);
      } catch (err) {
        // Past the deadline: dumpNow() reports it without writing
      }
      return await this.dumpNow({ signal });
    } finally {
      release();
    }
  }

  async dumpNow({ signal } = {}) {
    const started = performance.now();
    const stats = createStats(['serialize', 'store']);

    await pool(Object.keys(this.documents), async (name) => {
      // An older write of this document, still running past its deadline,
      // could land after this one: wait for it, within this deadline
      const pending = this.pendingWrites.get(name);
      try {
        if (pending) {
          await bounded(pending, signal);
        }
      } catch (err) {
        stats.timedOut = true;
        return;
      }
      if (signal && signal.aborted) {
        stats.timedOut = true;
        return;
      }

      let body;
      let start = performance.now();
      try {
        body = JSON.stringify(this.documents[name].dump());
      } catch (err) {
        failed(stats, name, err);
        return;
      } finally {
        stats.stages.serialize += since(start);
      }

      // Serializing blocks the event loop, deadline timer included: let it
      // fire before writing
      if (signal) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) {
          stats.timedOut = true;
          return;
        }
      }

      start = performance.now();
      const write = Promise.resolve().then(() =>
        this.storage.write(name, body, { signal })
      );
      const settled = write
        .catch(() => {})
        .then(() => {
          if (this.pendingWrites.get(name) === settled) {
            this.pendingWrites.delete(name);
          }
        });
      this.pendingWrites.set(name, settled);
      try {
        await bounded(write, signal);
        counted(stats, Buffer.byteLength(body));
      } catch (err) {
        failed(stats, name, err, signal);
      } finally {
        stats.stages.store += since(start);
      }
    });

    return this.record('dump', stats, since(started));
  }

  /**
   * Restore, then take periodic snapshots when `interval` is set.
   */
  async start(config = {}) {
    const { interval, deadlines = DEFAULT_DEADLINES } = config;
    this.stopping = false;
    this.loaded = false;
    if (!this.storage) {
      this.storage = storages.create(config);
    }
    if (!this.monitor) {
      this.monitor = monitoring.register({
        name: `persistence (${this.backendName()})`,
        type: 'persistence',
        speeds: [],
        status: 'Loading',
      });
    }
    // AbortSignal.timeout() doesn't keep the process alive, and nothing else
    // may before the inputs start: hold it until the restore is over
    const keepAlive = setInterval(() => {}, MAX_TIMER);
    try {
      // Aborted by stop() too
      this.restore = new AbortController();
      this.loading = this.load({
        signal: AbortSignal.any([
          deadline(deadlines.load),
          this.restore.signal,
        ]),
      });
      await this.loading;
    } finally {
      clearInterval(keepAlive);
    }
    this.loaded = true;

    if (interval && !this.stopping) {
      this.snapshots = true;
      const schedule = () => {
        // The next snapshot is scheduled once the previous one is over
        this.timer = setTimeout(async () => {
          this.timer = null;
          // Aborted by stopSnapshots() too
          this.snapshot = new AbortController();
          await this.dump({
            signal: AbortSignal.any([
              deadline(deadlines.dump),
              this.snapshot.signal,
            ]),
          });
          this.snapshot = null;
          if (this.snapshots) {
            schedule();
          }
        }, toMs(interval));
        // Snapshots alone don't keep the process running
        this.timer.unref();
      };
      schedule();
    }
  }

  // Before stopping the inputs, so no snapshot starts during the shutdown
  stopSnapshots() {
    // Also keeps a restore still in progress from scheduling them
    this.stopping = true;
    this.snapshots = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A snapshot in progress would run on its own, longer deadline, and could
    // land after stop() returned: abort it, the final snapshot replaces it
    if (this.snapshot) {
      this.snapshot.abort(new Error('Persistence is stopping'));
    }
  }

  /**
   * Final snapshot, after the dump in progress if any, then close the
   * storage, even when dumping failed. Both within the stop deadline.
   */
  async stop(config = {}) {
    const { deadlines = DEFAULT_DEADLINES } = config;
    this.stopSnapshots();
    if (!this.storage) {
      return;
    }
    const signal = deadline(deadlines.stop);
    // Stopped while restoring: wait for it, within the deadline
    if (this.loading && !this.loaded) {
      try {
        await bounded(this.loading, signal);
      } catch (err) {
        // Still restoring
      }
    }
    if (this.loading && !this.loaded) {
      // Cancel it, so it can't change the data after stop() returns
      this.restore.abort(new Error('Persistence is stopping'));
      await this.loading;
      // Dumping a partial restore would overwrite the stored snapshot
      console.warn(
        'Persistence: stopped before the data was restored, not dumping.'
      );
    } else {
      try {
        await this.dump({ signal });
      } catch (err) {
        console.error('Error dumping aggregators:', err.message);
      }
    }
    try {
      await bounded(
        Promise.resolve().then(() => this.storage.close()),
        signal
      );
    } catch (err) {
      console.error('Error closing the persistence storage:', err.message);
    }
  }

  backendName() {
    return (this.storage && this.storage.name) || 'custom';
  }

  record(operation, stats, total) {
    const result = {
      backend: this.backendName(),
      at: new Date().toISOString(),
      documents: stats.documents,
      bytes: stats.bytes,
      largest: stats.largest,
      missing: stats.missing,
      failed: stats.failed,
      timedOut: stats.timedOut,
      // Milliseconds. Stages are summed over the documents, the total is
      // wall-clock time: documents are handled in parallel
      total: Math.round(total),
      stages: Object.fromEntries(
        Object.entries(stats.stages).map(([stage, ms]) => [
          stage,
          Math.round(ms),
        ])
      ),
    };
    this.latest[operation] = result;

    console.log(`Persistence ${describe(operation, result)}`);
    if (this.monitor) {
      this.monitor.status = ['load', 'dump']
        .filter((op) => this.latest[op])
        .map(
          (op) => `${describe(op, this.latest[op])} at ${this.latest[op].at}`
        )
        .join('; ');
      this.monitor.persistence = this.latest;
    }
    debugPersistence(result);
    return result;
  }
}

function createStats(stages) {
  return {
    documents: 0,
    bytes: 0,
    largest: null,
    missing: 0,
    failed: 0,
    timedOut: false,
    stages: Object.fromEntries(stages.map((stage) => [stage, 0])),
  };
}

function counted(stats, bytes) {
  stats.documents++;
  stats.bytes += bytes;
  if (!stats.largest || bytes > stats.largest) {
    stats.largest = bytes;
  }
}

function failed(stats, name, err, signal) {
  if (signal && signal.aborted) {
    stats.timedOut = true;
    return;
  }
  stats.failed++;
  console.error(`Persistence: skipping ${name}: ${err.message}`);
}

// e.g. "(file) loaded 26 documents (213 MB) in 2.3s: fetch 0.27s, parse 0.52s,
// restore 1.5s"
function describe(operation, result) {
  const verb = operation === 'load' ? 'loaded' : 'dumped';
  const stages = Object.entries(result.stages)
    .map(([stage, ms]) => `${stage} ${formatSeconds(ms)}`)
    .join(', ');
  const notes = [
    result.missing && `${result.missing} missing`,
    result.failed && `${result.failed} failed`,
    result.timedOut && 'deadline passed',
  ].filter(Boolean);
  return `(${result.backend}) ${verb} ${result.documents} document${
    result.documents === 1 ? '' : 's'
  } (${formatBytes(
    result.bytes
  )}) in ${formatSeconds(result.total)}: ${stages}${
    notes.length ? `, ${notes.join(', ')}` : ''
  }`;
}

const persistence = new Persistence();

module.exports = persistence;
module.exports.Persistence = Persistence;
module.exports.safeName = safeName;
module.exports.normalize = normalize;
