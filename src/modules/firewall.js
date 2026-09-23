const fs = require('fs');
const path = require('path');

const debug = require('debug')('hyperwatch:firewall');
const { Map } = require('immutable');

const api = require('../app/api');
const constants = require('../constants');
const { Aggregator } = require('../lib/aggregator');
const lists = require('../lib/firewall/lists');
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

  api.registerAggregator('firewall', aggregator);
}

module.exports = {
  init,
  start,
  load,
  augment,
};
