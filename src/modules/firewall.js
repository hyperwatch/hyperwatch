const debug = require('debug')('hyperwatch:firewall');
const { Map, fromJS } = require('immutable');

const api = require('../app/api');
const constants = require('../constants');
const { Aggregator } = require('../lib/aggregator');
const { createClient } = require('../lib/cloudflare/client');
const lists = require('../lib/firewall/lists');
const { createStore } = require('../lib/firewall/store');
const sync = require('../lib/firewall/sync');
const { Formatter } = require('../lib/formatter');
const monitoring = require('../lib/monitoring');
const pipeline = require('../lib/pipeline');
const { aggregateCount, parseBoolean, parseNumber } = require('../lib/util');

const RELOAD_INTERVAL = 5000;

let matcher = () => null;
// Whether the latest load succeeded: a sync reloads otherwise
let listsLoaded = false;

// Where the lists are kept (see ../lib/firewall/store), set by init()
let store = null;
// The first load, awaited by hyperwatch.start() before the inputs start
let loading = Promise.resolve(false);
// Edits and Cloudflare syncs run one after the other: each reads, changes
// and writes the lists
let queue = Promise.resolve();

function enqueue(fn) {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
}

// Automatic Cloudflare sync (modules.firewall.sync), when on
let autoSync = null;
// Set by stop(), so a load finishing later doesn't start syncing, and new
// edits are refused
let stopped = false;
// Aborted when stop() gives up waiting: work still running makes no
// further Cloudflare update or storage write
let shutdown = new AbortController();

// Back to running, after stop(): init() does it when Hyperwatch starts
function resume() {
  stopped = false;
  if (shutdown.signal.aborted) {
    shutdown = new AbortController();
  }
}

const getStore = () => store || (store = createStore(constants));

// The lists declared in modules.firewall.lists (id, type, action, optional
// cloudflare link and entries), validated
function configuredLists(config = constants.modules.firewall || {}) {
  return lists.validate({
    lists: (config.lists || []).map((list) => ({
      entries: [],
      ...list,
    })),
  });
}

/**
 * The lists to work with: the stored ones, plus the configured lists they
 * don't have (empty, so a linked list gets its entries from Cloudflare at
 * the next sync). With nothing stored yet, the configured lists alone. The
 * stored lists win: configuration only adds missing lists.
 */
async function current(from, options, defaults = configuredLists()) {
  const stored = await from.readLists(options);
  if (!stored) {
    if (!defaults.lists.length) {
      throw new Error(
        'no lists stored yet, and none in modules.firewall.lists'
      );
    }
    return defaults;
  }
  const ids = new Set(stored.lists.map((list) => list.id));
  const missing = defaults.lists.filter((list) => !ids.has(list.id));
  return missing.length
    ? lists.validate({ ...stored, lists: [...stored.lists, ...missing] })
    : stored;
}

// Load and compile the lists. Missing or invalid lists keep the lists
// already loaded, so a bad edit never disables the firewall.
// `opened`: the open() generation that started the load. A load from an
// earlier one (still running after a stop() and a new start()) is dropped
// rather than replacing the current lists
async function load(from = getStore(), options, opened) {
  try {
    const data = await current(from, options);
    if (opened !== undefined && opened !== generation) {
      return false;
    }
    matcher = lists.compile(data);
    listsLoaded = true;
    debug(`Loaded ${data.lists.length} list(s) from ${from.where}`);
    return true;
  } catch (err) {
    listsLoaded = false;
    console.warn(
      `firewall: keeping previous lists, ${from.where}: ${err.message}`
    );
    return false;
  }
}

function augment(log) {
  const match = matcher(log);
  return match ? log.set('firewall', Map(match)) : log;
}

// Lists with their entries. Linked lists also get `pending`: the values
// added and removed locally since the last Cloudflare sync, or null when the
// list was never synced.
async function summary(from = getStore()) {
  const data = await current(from);
  const state = await from.readState();
  return {
    lists: data.lists.map((list) => {
      if (!list.cloudflare) {
        return list;
      }
      const saved = sync.savedState(state, list.id);
      if (!saved || saved.rule_id !== list.cloudflare.rule_id) {
        return { ...list, pending: null };
      }
      const base = new Set(saved.values);
      const local = new Set(list.entries.map((entry) => entry.value));
      return {
        ...list,
        pending: {
          added: [...local].filter((value) => !base.has(value)),
          removed: [...base].filter((value) => !local.has(value)),
        },
      };
    }),
  };
}

// Which list, if any, each IP address and user agent falls into
// Results keyed by the values asked for, as own properties: a user agent
// "__proto__" would otherwise set the prototype
const setResult = (target, key, log) =>
  Object.defineProperty(target, key, {
    value: log.has('firewall') ? log.get('firewall').toJS() : null,
    enumerable: true,
    writable: true,
    configurable: true,
  });

function lookup({ addresses = [], user_agents = [] } = {}) {
  const result = { addresses: {}, user_agents: {} };
  for (const address of addresses) {
    setResult(
      result.addresses,
      address,
      augment(fromJS({ address: { value: address } }))
    );
  }
  for (const ua of user_agents) {
    setResult(
      result.user_agents,
      ua,
      augment(fromJS({ request: { headers: { 'user-agent': ua } } }))
    );
  }
  return result;
}

// Add or remove one entry, then reload so matching is updated right away.
// Reads the stored lists first, so the edit applies to their latest version.
function edit(to, listId, op, { value, reason, source } = {}) {
  const refuse = () => {
    if (stopped) {
      throw new Error('firewall: Hyperwatch is stopping, edit refused');
    }
  };
  if (stopped) {
    return Promise.reject(
      new Error('firewall: Hyperwatch is stopping, edit refused')
    );
  }
  // The shutdown and the open() this edit belongs to: once a stop() gave up
  // on it, it ends, even if Hyperwatch has started again meanwhile
  const { signal } = shutdown;
  const opened = generation;
  return enqueue(async () => {
    refuse();
    signal.throwIfAborted();
    const data = await current(to, { signal });
    signal.throwIfAborted();
    const next =
      op === 'add'
        ? lists.addEntry(data, listId, { value, reason, source })
        : lists.removeEntry(data, listId, value);
    if (next !== data) {
      await to.writeLists(next, { signal });
      signal.throwIfAborted();
      await load(to, undefined, opened);
      if (autoSync && opened === generation) {
        autoSync.scheduleUp();
      }
    }
  });
}

const changes = ({ add, remove }) =>
  [...add.map((v) => `+${v}`), ...remove.map((v) => `-${v}`)].join(' ');

// Sync the stored lists with Cloudflare in each direction, in order (see
// ../lib/firewall/sync). Logs and returns what changed or was skipped:
// [{ direction, list, change | skipped }]
async function syncLists(to, client, directions, { signal } = {}) {
  const results = [];
  for (const direction of directions) {
    if (signal) {
      signal.throwIfAborted();
    }
    const data = await current(to);
    const state = await to.readState();
    const items = sync.plan({
      data,
      state,
      ruleset: await client.getEntrypoint({ signal }),
      direction,
    });
    const result = await sync.apply(items, {
      client,
      originalData: data,
      readData: () => current(to),
      writeData: (next) => to.writeLists(next, { signal }),
      state,
      signal,
    });
    // Lists written: match them now, even if saving the state fails next
    if (result.localWritten) {
      await load(to);
    }
    if (result.items.some((item) => item.applied)) {
      await to.writeState(result.state, { signal });
    }
    for (const item of result.items) {
      const where = `firewall: sync ${direction} ${item.listId}`;
      for (const warning of item.warnings) {
        console.warn(`${where}: ${warning}`);
      }
      const result = { direction, list: item.listId };
      const skipped = item.errors.length
        ? item.errors.join('; ')
        : item.skipped;
      if (skipped) {
        console.warn(`${where} skipped: ${skipped}`);
        results.push({ ...result, skipped });
      } else if (sync.hasChanges(item)) {
        const version = item.newVersion ? ` (rule v${item.newVersion})` : '';
        const change = `${
          changes(direction === 'up' ? item.toRemote : item.toLocal) ||
          'action or description'
        }${version}`;
        console.log(`${where}: ${change}`);
        results.push({ ...result, change });
      }
    }
  }
  // The lists read fine: if the latest load failed (e.g. storage briefly
  // down at start), match them now rather than at the next local change
  if (!listsLoaded) {
    await load(to);
  }
  return results;
}

// The "firewall sync" entry of /status: the latest sync and what it did
let syncMonitor = null;

function reportSync(directions, results, error) {
  if (!syncMonitor) {
    syncMonitor = monitoring.register({
      name: 'firewall sync',
      type: 'firewall',
      speeds: [],
      status: 'Waiting for the first sync',
    });
  }
  const at = new Date().toISOString();
  const what = error
    ? `failed: ${error.message}`
    : results
        .map(
          (r) =>
            `${r.direction} ${r.list} ${r.change || `skipped: ${r.skipped}`}`
        )
        .join('; ') || 'in sync';
  syncMonitor.status = `${directions.join(', ')} at ${at}: ${what}`;
  syncMonitor.firewallSync = {
    at,
    directions,
    results: results || [],
    error: error ? error.message : null,
  };
}

const MAX_SECONDS = (2 ** 31 - 1) / 1000;

// modules.firewall.sync: { auto, delay, interval }, with defaults
function syncSettings(config = {}) {
  const settings = config.sync || {};
  const seconds = (key, fallback) => {
    if (settings[key] === undefined || settings[key] === null) {
      return fallback;
    }
    const value = parseNumber(settings[key], { min: 0, max: MAX_SECONDS });
    if (value === null) {
      console.warn(
        `Invalid modules.firewall.sync.${key} "${settings[key]}": using ${fallback}.`
      );
      return fallback;
    }
    return value;
  };
  return {
    auto: parseBoolean(settings.auto),
    delay: seconds('delay', 10),
    interval: seconds('interval', 300),
  };
}

/**
 * Keep Cloudflare in sync without anyone running the CLI: `up` a few seconds
 * (`delay`) after each edit, a burst of edits going out as one sync, and a
 * full sync (`down` then `up`) after start and every `interval` seconds (0:
 * never). Syncs wait for the edits and syncs before them.
 */
function startAutoSync(to, client, { delay, interval }) {
  stopAutoSync();
  let upTimer = null;
  const timers = [];
  // Set by stop(): syncs still queued don't run
  let cancelled = false;
  // A full sync waiting or running: periodic ticks meanwhile are dropped,
  // instead of queueing up when a sync takes longer than the interval
  let fullPending = false;
  const run = (directions) =>
    enqueue(() =>
      cancelled
        ? null
        : syncLists(to, client, directions, { signal: shutdown.signal })
    ).then(
      (results) => {
        if (results) {
          reportSync(directions, results);
        }
      },
      (err) => {
        console.warn(
          `firewall: sync ${directions.join(', ')} failed: ${err.message}`
        );
        reportSync(directions, null, err);
      }
    );
  const full = () => {
    if (fullPending || cancelled) {
      return;
    }
    fullPending = true;
    run(['down', 'up']).finally(() => {
      fullPending = false;
    });
  };

  // The first full sync after `delay`, then every `interval` from there
  timers.push(
    setTimeout(() => {
      full();
      if (interval && !cancelled) {
        timers.push(setInterval(full, interval * 1000).unref());
      }
    }, delay * 1000).unref()
  );
  autoSync = {
    run,
    stop() {
      cancelled = true;
      timers.forEach(clearTimeout);
      clearTimeout(upTimer);
    },
    scheduleUp() {
      if (upTimer || cancelled) {
        return;
      }
      upTimer = setTimeout(() => {
        upTimer = null;
        run(['up']);
      }, delay * 1000);
      upTimer.unref();
    },
  };
  return autoSync;
}

function stopAutoSync() {
  if (autoSync) {
    autoSync.stop();
    autoSync = null;
  }
}

function registerRoutes() {
  const send = async (res, fn) => {
    try {
      res.json((await fn()) || { ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  api.get('/firewall/lists.json', (req, res) => send(res, () => summary()));
  api.post('/firewall/lookup', (req, res) => send(res, () => lookup(req.body)));
  // Edits change what Cloudflare blocks (with automatic sync), and
  // Hyperwatch has no authentication of its own: they're off unless
  // modules.firewall.edits is on, for instances behind authentication
  for (const op of ['add', 'remove']) {
    api.post(`/firewall/lists/:id/${op}`, (req, res) => {
      if (!parseBoolean((constants.modules.firewall || {}).edits)) {
        res.status(403).json({
          error:
            'firewall: edits are off; set modules.firewall.edits behind authentication',
        });
        return;
      }
      send(res, () => edit(getStore(), req.params.id, op, req.body || {}));
    });
  }
}

// Incremented by each open(): a load started by an earlier open, still
// running after a stop() and a new start(), doesn't start syncing
let generation = 0;

// Open the store, load the lists and start the automatic sync: at init, and
// again when Hyperwatch starts after a stop() (init() runs only once)
function open() {
  resume();
  const opened = ++generation;
  store = createStore(constants);
  // Bounded like restoring persistence (seconds)
  const { deadlines = {} } = constants.persistence;
  const deadline = deadlines.load || 60;
  // Whole milliseconds: AbortSignal.timeout() throws otherwise (1.001 s)
  // Aborted at stop() too, so a pending read ends with the store
  loading = load(
    store,
    {
      signal: AbortSignal.any([
        AbortSignal.timeout(Math.max(1, Math.round(deadline * 1000))),
        shutdown.signal,
      ]),
    },
    opened
  );
  store.watch(() => load(store, undefined, opened), RELOAD_INTERVAL);

  const settings = syncSettings(constants.modules.firewall);
  if (settings.auto) {
    let client;
    try {
      client = createClient();
    } catch (err) {
      console.warn(
        `firewall: automatic Cloudflare sync is off: ${err.message}`
      );
    }
    if (client) {
      const to = store;
      loading.then(() => {
        if (!stopped && opened === generation) {
          startAutoSync(to, client, settings);
        }
      });
    }
  }
}

function init() {
  // Invalid list definitions fail here, before anything starts
  configuredLists();
  open();
  pipeline.getNode('main').map(augment).registerNode('main');
}

// Set once start() registered the aggregator and the routes
let started = false;

function start() {
  // Hyperwatch starting again after stop()
  if (stopped) {
    open();
  }
  if (started) {
    return;
  }
  started = true;
  const aggregator = new Aggregator();

  aggregator.setIdentifier((log) => log.getIn(['firewall', 'list']));

  const formatter = new Formatter();
  formatter.setFormats([
    ['list', (entry) => entry.getIn(['firewall', 'list'])],
    ['action', (entry) => entry.getIn(['firewall', 'action'])],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],
  ]);
  aggregator.setFormatter(formatter);

  aggregator.setEnricher((entry, log) =>
    entry.set('firewall', log.get('firewall'))
  );

  pipeline
    .getNode('main')
    .filter((log) => log.has('firewall'))
    .map((log) => aggregator.processLog(log), 'aggregator');

  // Before the aggregator, whose /firewall/:identifier.json would shadow
  // /firewall/lists.json
  registerRoutes();
  api.registerAggregator('firewall', aggregator);
}

// Resolves once the lists are first loaded (or failed to)
const ready = () => loading;

// No more automatic syncs once Hyperwatch stops. An edit or sync already
// running finishes first, within the persistence stop deadline, so its
// writes aren't cut short when the storage closes
async function stop() {
  stopped = true;
  stopAutoSync();
  const { deadlines = {} } = constants.persistence;
  const ms = Math.max(1, Math.round((deadlines.stop || 20) * 1000));
  let timer;
  await Promise.race([
    queue,
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
  // Whatever still runs: no further Cloudflare update or storage write
  shutdown.abort(new Error('firewall: Hyperwatch stopped'));
  if (store) {
    await store.close();
  }
}

module.exports = {
  init,
  start,
  ready,
  stop,
  resume,
  syncLists,
  syncSettings,
  configuredLists,
  startAutoSync,
  stopAutoSync,
  load,
  augment,
  summary,
  lookup,
  edit,
};
