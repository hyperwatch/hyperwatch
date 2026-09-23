const fs = require('fs');
const path = require('path');

const debug = require('debug')('hyperwatch:firewall');
const { Map, fromJS } = require('immutable');

const api = require('../app/api');
const constants = require('../constants');
const { Aggregator } = require('../lib/aggregator');
const lists = require('../lib/firewall/lists');
const sync = require('../lib/firewall/sync');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { aggregateCount } = require('../lib/util');

const RELOAD_INTERVAL = 5000;

let matcher = () => null;

const filePath = () =>
  (constants.modules.firewall && constants.modules.firewall.path) ||
  path.join(process.cwd(), 'firewall.json');

// Load and compile the lists. A missing or invalid file keeps the lists
// already loaded, so a bad edit never disables the firewall.
function load(file = filePath()) {
  try {
    const data = lists.load(file);
    matcher = lists.compile(data);
    debug(`Loaded ${data.lists.length} list(s) from ${file}`);
    return true;
  } catch (err) {
    console.warn(`firewall: keeping previous lists, ${file}: ${err.message}`);
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
function summary(file = filePath()) {
  const data = lists.load(file);
  const state = sync.loadState(sync.defaultStatePath(file));
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

// Add or remove one entry, then reload so matching is updated right away
function edit(file, listId, op, { value, reason, source } = {}) {
  const data = lists.load(file);
  const next =
    op === 'add'
      ? lists.addEntry(data, listId, { value, reason, source })
      : lists.removeEntry(data, listId, value);
  if (next !== data) {
    lists.save(file, next);
    load(file);
  }
}

function registerRoutes() {
  const send = (res, fn) => {
    try {
      res.json(fn() || { ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  api.get('/firewall/lists.json', (req, res) => send(res, () => summary()));
  api.post('/firewall/lookup', (req, res) => send(res, () => lookup(req.body)));
  for (const op of ['add', 'remove']) {
    api.post(`/firewall/lists/:id/${op}`, (req, res) =>
      send(res, () => {
        edit(filePath(), req.params.id, op, req.body || {});
      })
    );
  }
}

function init() {
  const file = filePath();
  load(file);
  fs.watchFile(file, { interval: RELOAD_INTERVAL }, () => load(file)).unref();

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

module.exports = {
  init,
  start,
  load,
  augment,
  summary,
  lookup,
  edit,
};
