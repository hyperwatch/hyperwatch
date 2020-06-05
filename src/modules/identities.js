const Table = require('easy-table');
const { Map, Set } = require('immutable');

const api = require('../app/api');
const pipeline = require('../lib/pipeline');
const { Speed } = require('../lib/speed');
const { aggregateSpeed } = require('../lib/util');

let entries = new Map();

let mapper = (entry) => ({
  identity: entry.getIn(['identity']),

  address:
    entry.getIn(['address', 'hostname']) ||
    entry.getIn(['address', 'value']) ||
    entry.getIn(['request', 'address']),

  cc: entry.getIn(['geoip', 'country']),
  reg: entry.getIn(['geoip', 'region']),
  city: entry.getIn(['geoip', 'city']),

  '15m': aggregateSpeed(entry, 'per_minute'),
  '24h': aggregateSpeed(entry, 'per_hour'),
});

function setMapper(fn) {
  mapper = fn;
}

let enricher = (entry, log) => {
  for (const field of [
    'address',
    'identity',
    'cloudflare',
    'dnsbl',
    'geoip',
    'hostname',
    'useragent',
  ]) {
    // Last win
    if (log.has(field)) {
      entry = entry.set(field, log.get(field));
    }
  }
  return entry;
};

function setEnricher(fn) {
  enricher = fn;
}

const sorters = {
  '15m': (address) => aggregateSpeed(address, 'per_minute'),
  '24h': (address) => aggregateSpeed(address, 'per_hour'),
  latest: (address) => address.getIn(['speed', 'per_minute']).latest,
};

let identifier = (log) => {
  return (
    log.getIn(['identity']) ||
    log.getIn(['address', 'hostname']) ||
    log.getIn(['address', 'value']) ||
    log.getIn(['request', 'address'])
  );
};

function setIdentifier(fn) {
  identifier = fn;
}

function load() {
  pipeline.getNode('main').map((log) => {
    const id = identifier(log);

    if (!entries.has(id)) {
      entries = entries
        .setIn([id, 'speed', 'per_minute'], new Speed(60, 15).hit())
        .setIn([id, 'speed', 'per_hour'], new Speed(3600, 24).hit());
    } else {
      entries = entries
        .updateIn([id, 'speed', 'per_minute'], (speed) => speed.hit())
        .updateIn([id, 'speed', 'per_hour'], (speed) => speed.hit());
    }

    entries = entries.updateIn([id], (id) => enricher(id, log));
  });

  api.get('/identities(.:format(txt|json))?', (req, res) => {
    let sortKey = req.query.sort;
    if (!sortKey || !sorters[sortKey]) {
      sortKey = '15m';
    }

    const rawData = entries
      .map(sorters[sortKey])
      .sort()
      .reverse()
      .slice(0, req.query.limit || 100)
      .keySeq()
      .map((id) => entries.get(id));

    const data = req.query.raw
      ? rawData
      : rawData.map((address) => mapper(address, req.params.format));

    if (req.params.format === 'txt') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(Table.print(data.toJS()));
    } else {
      res.send(data);
    }
  });
}

const gcSize = 1000;

const gc = () => {
  if (entries.size < gcSize) {
    return;
  }

  let keepList = new Set();
  for (const sorter of Object.values(sorters)) {
    const keepKeys = entries
      .map(sorter)
      .sort()
      .reverse()
      .slice(0, gcSize)
      .keySeq();
    keepList = keepList.union(keepKeys);
  }

  entries = entries.filter((value, key) => keepList.has(key));
};

setInterval(gc, 60 * 1000);

module.exports = { load, setMapper, setEnricher, setIdentifier };
