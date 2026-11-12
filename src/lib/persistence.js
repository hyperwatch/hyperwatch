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
const { parseBoolean, parseNumber } = require('./util');

const debugPersistence = debug('hyperwatch:persistence');

/** @typedef {import('./storage').Storage} Storage */

/**
 * What persistence saves and restores under a name: an aggregator or a
 * history buffer
 * @typedef {object} Persistable
 * @property {() => Record<string, any>[]} dump
 * @property {(data: Record<string, any>[]) => void} load
 */

/**
 * Deadlines of the load, dump and stop phases, in seconds
 * @typedef {{ load: number, dump: number, stop: number }} Deadlines
 */

/**
 * The persistence configuration (`persistence`, see docs/configuration.md),
 * as normalize() leaves it
 * @typedef {import('./storage').StorageConfig & {
 *   enabled?: boolean,
 *   interval?: number | null,
 *   deadlines?: Deadlines,
 * }} PersistenceConfig
 */

/**
 * Counters of a load or a dump in progress
 * @typedef {object} Stats
 * @property {number} documents
 * @property {number} bytes
 * @property {number | null} largest
 * @property {number} missing
 * @property {number} failed
 * @property {boolean} timedOut
 * @property {Record<string, number>} stages Milliseconds per stage
 */

/**
 * The outcome of a load or a dump, logged and shown on the status page
 * @typedef {object} PersistenceResult
 * @property {string} backend
 * @property {string} at
 * @property {number} documents
 * @property {number} bytes
 * @property {number | null} largest
 * @property {number} missing
 * @property {number} failed
 * @property {boolean} timedOut
 * @property {number} total Milliseconds, wall-clock
 * @property {Record<string, number>} stages Milliseconds per stage
 */

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// Documents read or written at the same time
const CONCURRENCY = 4;

// Seconds
const DEFAULT_DEADLINES = { load: 60, dump: 60, stop: 20 };

// Encode any string into a name accepted by register(). Characters outside
// [A-Za-z0-9.-], including '_' itself, become _<hex code point>_, so distinct
// inputs never map to the same name.
/** @param {string} name */
function safeName(name) {
  return String(name).replace(
    /[^A-Za-z0-9.-]/gu,
    (c) => `_${/** @type {number} */ (c.codePointAt(0)).toString(16)}_`
  );
}

const isSet = (/** @type {unknown} */ value) =>
  value !== null && value !== undefined && value !== '';

// Longest delay Node timers support, in milliseconds (about 24.8 days):
// setTimeout() fires after 1 ms beyond it
const MAX_TIMER = 2 ** 31 - 1;

// Timers take whole milliseconds: AbortSignal.timeout() throws otherwise,
// e.g. for 0.07 * 1000 = 70.00000000000001
const toMs = (/** @type {number} */ seconds) => Math.round(seconds * 1000);

// Seconds, as a number timers support, or null
const positive = (/** @type {unknown} */ value) => {
  const seconds = parseNumber(value);
  if (seconds === null) {
    return null;
  }
  const ms = toMs(seconds);
  return ms >= 1 && ms <= MAX_TIMER ? seconds : null;
};

/**
 * Normalize the persistence constants in place. Values set through the
 * environment (rc) are strings, and "false" would be truthy.
 * @param {Record<string, any>} config
 * @returns {PersistenceConfig}
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
  if (config.s3) {
    config.s3.forcePathStyle = parseBoolean(config.s3.forcePathStyle);
  }
  const backend = storages.backends[config.backend];
  if (config.enabled && backend.validate) {
    backend.validate(config);
  }

  return config;
}

const deadline = (/** @type {number | undefined} */ seconds) =>
  seconds ? AbortSignal.timeout(toMs(seconds)) : undefined;

// The deadline of each phase, the default for a missing or invalid one:
// start() and stop() may get deadlines that normalize() didn't fill
/**
 * @param {{ deadlines?: Partial<Record<keyof Deadlines, unknown>> }} config
 * @returns {Deadlines}
 */
const deadlinesOf = (config) => {
  const given = config.deadlines || {};
  const deadlines = { ...DEFAULT_DEADLINES };
  for (const phase of /** @type {(keyof Deadlines)[]} */ (
    Object.keys(DEFAULT_DEADLINES)
  )) {
    deadlines[phase] = positive(given[phase]) || DEFAULT_DEADLINES[phase];
  }
  return deadlines;
};

// Settles with `promise`, or rejects as soon as `signal` aborts, so a stalled
// operation can't hold a phase past its deadline
/**
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
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

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<void>} worker
 */
async function pool(items, worker) {
  const queue = [...items];
  const run = async () => {
    while (queue.length) {
      await worker(/** @type {T} */ (queue.shift()));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

const since = (/** @type {number} */ start) => performance.now() - start;

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes >= 1e6) {
    return `${(bytes / 1e6).toFixed(bytes >= 1e7 ? 0 : 1)} MB`;
  }
  if (bytes >= 1e3) {
    return `${Math.round(bytes / 1e3)} kB`;
  }
  return `${bytes} B`;
}

const formatSeconds = (/** @type {number} */ ms) =>
  `${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)}s`;

class Persistence {
  constructor() {
    /** @type {Record<string, Persistable>} */
    this.documents = Object.create(null);
    /** @type {Storage | null} */
    this.storage = null;
    // Released when the dump in progress is over, see dump()
    /** @type {Promise<unknown>} */
    this.queue = Promise.resolve();
    // Writes still running per document, even past their deadline
    /** @type {Map<string, Promise<void>>} */
    this.pendingWrites = new Map();
    /** @type {{ load: PersistenceResult | null, dump: PersistenceResult | null }} */
    this.latest = { load: null, dump: null };
    /** @type {import('./monitoring').MonitoringItem | null} */
    this.monitor = null;
    /** @type {NodeJS.Timeout | null} */
    this.timer = null;
    this.snapshots = false;
    // Aborts the periodic snapshot in progress
    /** @type {AbortController | null} */
    this.snapshot = null;
    // Restoring at start, and whether it's over
    /** @type {Promise<PersistenceResult> | null} */
    this.loading = null;
    this.loaded = false;
    this.stopping = false;
    // Aborts the restore in progress
    /** @type {AbortController | null} */
    this.restore = null;
  }

  /**
   * @param {string} name
   * @param {Persistable} target
   */
  register(name, target) {
    if (!SAFE_NAME.test(name)) {
      throw new Error(`Invalid aggregator name for persistence: "${name}"`);
    }
    this.documents[name] = target;
  }

  // Like cache.setProvider(): replaces the backend selected by the constants
  /** @param {Storage} storage */
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
  /** @param {import('../types').Abortable} [options] */
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
          Promise.resolve().then(() =>
            /** @type {Storage} */ (this.storage).read(name, { signal })
          ),
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
  /** @param {import('../types').Abortable} [options] */
  async dump({ signal } = {}) {
    const previous = this.queue;
    /** @type {((value?: unknown) => void) | undefined} */
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
      /** @type {(value?: unknown) => void} */ (release)();
    }
  }

  /** @param {import('../types').Abortable} [options] */
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
        /** @type {Storage} */ (this.storage).write(name, body, { signal })
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
   * @param {PersistenceConfig} [config]
   */
  async start(config = {}) {
    const { interval } = config;
    const deadlines = deadlinesOf(config);
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
          // Positive once normalized
          /** @type {AbortSignal} */ (deadline(deadlines.load)),
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
              /** @type {AbortSignal} */ (deadline(deadlines.dump)),
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
   * @param {PersistenceConfig} [config]
   */
  async stop(config = {}) {
    const deadlines = deadlinesOf(config);
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
      /** @type {AbortController} */ (this.restore).abort(
        new Error('Persistence is stopping')
      );
      await this.loading;
      // Dumping a partial restore would overwrite the stored snapshot
      console.warn(
        'Persistence: stopped before the data was restored, not dumping.'
      );
    } else {
      try {
        await this.dump({ signal });
      } catch (err) {
        console.error(
          'Error dumping aggregators:',
          /** @type {Error} */ (err).message
        );
      }
    }
    try {
      await bounded(
        // close() is optional: a storage may have nothing to release
        Promise.resolve().then(() => {
          const storage = /** @type {Storage} */ (this.storage);
          return storage.close && storage.close();
        }),
        signal
      );
    } catch (err) {
      console.error(
        'Error closing the persistence storage:',
        /** @type {Error} */ (err).message
      );
    }
  }

  backendName() {
    return (this.storage && this.storage.name) || 'custom';
  }

  /**
   * @param {'load' | 'dump'} operation
   * @param {Stats} stats
   * @param {number} total Milliseconds
   * @returns {PersistenceResult}
   */
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
      this.monitor.status = /** @type {('load' | 'dump')[]} */ ([
        'load',
        'dump',
      ])
        .filter((op) => this.latest[op])
        .map((op) => {
          const latest = /** @type {PersistenceResult} */ (this.latest[op]);
          return `${describe(op, latest)} at ${latest.at}`;
        })
        .join('; ');
      this.monitor.persistence = this.latest;
    }
    debugPersistence(result);
    return result;
  }
}

/**
 * @param {string[]} stages
 * @returns {Stats}
 */
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

/**
 * @param {Stats} stats
 * @param {number} bytes
 */
function counted(stats, bytes) {
  stats.documents++;
  stats.bytes += bytes;
  if (!stats.largest || bytes > stats.largest) {
    stats.largest = bytes;
  }
}

/**
 * @param {Stats} stats
 * @param {string} name
 * @param {unknown} err
 * @param {AbortSignal} [signal]
 */
function failed(stats, name, err, signal) {
  if (signal && signal.aborted) {
    stats.timedOut = true;
    return;
  }
  stats.failed++;
  console.error(
    `Persistence: skipping ${name}: ${/** @type {Error} */ (err).message}`
  );
}

// e.g. "(file) loaded 26 documents (213 MB) in 2.3s: fetch 0.27s, parse 0.52s,
// restore 1.5s"
/**
 * @param {string} operation
 * @param {PersistenceResult} result
 */
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

module.exports = Object.assign(persistence, {
  Persistence,
  safeName,
  normalize,
});
