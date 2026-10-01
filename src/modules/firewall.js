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
const pipeline = require('../lib/pipeline');
const { aggregateCount, parseBoolean, parseNumber } = require('../lib/util');

const RELOAD_INTERVAL = 5000;

let matcher = () => null;

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

const getStore = () => store || (store = createStore(constants));

// Load and compile the lists. Missing or invalid lists keep the lists
// already loaded, so a bad edit never disables the firewall.
async function load(from = getStore(), options) {
  try {
    const data = await from.readLists(options);
    matcher = lists.compile(data);
    debug(`Loaded ${data.lists.length} list(s) from ${from.where}`);
    return true;
  } catch (err) {
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
  const data = await from.readLists();
  const state = await from.readState();
  return {
    lists: data.lists.map((list) => {
      if (!list.cloudflare) {
        return list;
      }
      const saved = state.lists[list.id];
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
function lookup({ addresses = [], user_agents = [] } = {}) {
  const result = { addresses: {}, user_agents: {} };
  for (const address of addresses) {
    const log = augment(fromJS({ address: { value: address } }));
    result.addresses[address] = log.has('firewall')
      ? log.get('firewall').toJS()
      : null;
  }
  for (const ua of user_agents) {
    const log = augment(fromJS({ request: { headers: { 'user-agent': ua } } }));
    result.user_agents[ua] = log.has('firewall')
      ? log.get('firewall').toJS()
      : null;
  }
  return result;
}

// Add or remove one entry, then reload so matching is updated right away.
// Reads the stored lists first, so the edit applies to their latest version.
function edit(to, listId, op, { value, reason, source } = {}) {
  return enqueue(async () => {
    const data = await to.readLists();
    const next =
      op === 'add'
        ? lists.addEntry(data, listId, { value, reason, source })
        : lists.removeEntry(data, listId, value);
    if (next !== data) {
      await to.writeLists(next);
      await load(to);
      if (autoSync) {
        autoSync.scheduleUp();
      }
    }
  });
}

const changes = ({ add, remove }) =>
  [...add.map((v) => `+${v}`), ...remove.map((v) => `-${v}`)].join(' ');

// Sync the stored lists with Cloudflare in each direction, in order (see
// ../lib/firewall/sync), and report what changed or was skipped
async function syncLists(to, client, directions) {
  for (const direction of directions) {
    const data = await to.readLists();
    const state = await to.readState();
    const items = sync.plan({
      data,
      state,
      ruleset: await client.getEntrypoint(),
      direction,
    });
    const result = await sync.apply(items, {
      client,
      originalData: data,
      readData: () => to.readLists(),
      writeData: (next) => to.writeLists(next),
      state,
    });
    if (result.items.some((item) => item.applied)) {
      await to.writeState(result.state);
    }
    if (result.localWritten) {
      await load(to);
    }
    for (const item of result.items) {
      const where = `firewall: sync ${direction} ${item.listId}`;
      for (const warning of item.warnings) {
        console.warn(`${where}: ${warning}`);
      }
      if (item.errors.length) {
        console.warn(`${where} skipped: ${item.errors.join('; ')}`);
      } else if (item.skipped) {
        console.warn(`${where} skipped: ${item.skipped}`);
      } else if (sync.hasChanges(item)) {
        const change = changes(
          direction === 'up' ? item.toRemote : item.toLocal
        );
        const version = item.newVersion ? ` (rule v${item.newVersion})` : '';
        console.log(`${where}: ${change || 'action or description'}${version}`);
      }
    }
  }
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
  const run = (directions) =>
    enqueue(() => syncLists(to, client, directions)).catch((err) =>
      console.warn(
        `firewall: sync ${directions.join(', ')} failed: ${err.message}`
      )
    );
  const full = () => run(['down', 'up']);

  timers.push(setTimeout(full, delay * 1000).unref());
  if (interval) {
    timers.push(setInterval(full, interval * 1000).unref());
  }
  autoSync = {
    run,
    stop() {
      timers.forEach(clearTimeout);
      clearTimeout(upTimer);
    },
    scheduleUp() {
      if (upTimer) {
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
  for (const op of ['add', 'remove']) {
    api.post(`/firewall/lists/:id/${op}`, (req, res) =>
      send(res, () => edit(getStore(), req.params.id, op, req.body || {}))
    );
  }
}

function init() {
  store = createStore(constants);
  // Bounded like restoring persistence (seconds)
  const { deadlines = {} } = constants.persistence;
  const deadline = deadlines.load || 60;
  loading = load(store, { signal: AbortSignal.timeout(deadline * 1000) });
  store.watch(() => load(store), RELOAD_INTERVAL);

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
      loading.then(() => startAutoSync(to, client, settings));
    }
  }

  pipeline.getNode('main').map(augment).registerNode('main');
}

function start() {
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

module.exports = {
  init,
  start,
  ready,
  syncLists,
  syncSettings,
  startAutoSync,
  stopAutoSync,
  load,
  augment,
  summary,
  lookup,
  edit,
};
