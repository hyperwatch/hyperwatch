const { Map, Set, is } = require('immutable');

const {
  address,
  agent,
  city,
  country,
  identity,
  os,
} = require('../lib/formatter');
const { Speed } = require('../lib/speed');
const { aggregateSpeed } = require('../lib/util');

const defaultMapper = (entry) => ({
  identity: identity(entry),

  address: address(entry),

  cc: country(entry),
  city: city(entry),

  agent: agent(entry),
  os: os(entry),

  '15m': aggregateSpeed(entry, 'per_minute'),
  '24h': aggregateSpeed(entry, 'per_hour'),
});

const defaultEnricher = (entry, log) => {
  for (const field of [
    'address',
    'identity',
    'cloudflare',
    'dnsbl',
    'geoip',
    'hostname',
    'useragent',
  ]) {
    if (log.has(field) && !is(log.get(field), entry.get(field))) {
      entry = entry.set(field, log.get(field));
    }
  }
  return entry;
};

const defaultIdentifier = (log) => {
  return (
    log.getIn(['identity']) ||
    log.getIn(['address', 'value']) ||
    log.getIn(['request', 'address'])
  );
};

const defaultSorters = {
  '15m': (entry) => aggregateSpeed(entry, 'per_minute'),
  '24h': (entry) => aggregateSpeed(entry, 'per_hour'),
  latest: (entry) => entry.getIn(['speed', 'per_minute']).latest,
};

class Aggregator {
  constructor() {
    this.entries = new Map();
    this.mapper = defaultMapper;
    this.enricher = defaultEnricher;
    this.identifier = defaultIdentifier;
    this.sorters = defaultSorters;
    this.gcSize = 1000;

    setInterval(() => this.gc(), 60 * 1000);
  }

  setMapper(fn) {
    this.mapper = fn;
  }

  setEnricher(fn) {
    this.enricher = fn;
  }

  setIdentifier(fn) {
    this.identifier = fn;
  }

  processLog(log) {
    const id = this.identifier(log);

    if (!this.entries.has(id)) {
      this.entries = this.entries
        .setIn([id, 'speed', 'per_minute'], new Speed(60, 15).hit())
        .setIn([id, 'speed', 'per_hour'], new Speed(3600, 24).hit());
    } else {
      this.entries = this.entries
        .updateIn([id, 'speed', 'per_minute'], (speed) => speed.hit())
        .updateIn([id, 'speed', 'per_hour'], (speed) => speed.hit());
    }

    this.entries = this.entries.updateIn([id], (id) => this.enricher(id, log));

    return log;
  }

  getData({ raw, sort, format, limit }) {
    if (!sort || !this.sorters[sort]) {
      sort = '15m';
    }

    const rawData = this.entries
      .map(this.sorters[sort])
      .sort()
      .reverse()
      .slice(0, limit || 100)
      .keySeq()
      .map((id) => this.entries.get(id));

    return raw ? rawData : rawData.map((entry) => this.mapper(entry, format));
  }

  gc() {
    if (this.entries.size < this.gcSize) {
      return;
    }

    let keepList = new Set();
    for (const sorter of Object.values(this.sorters)) {
      const keepKeys = this.entries
        .map(sorter)
        .sort()
        .reverse()
        .slice(0, this.gcSize)
        .keySeq();
      keepList = keepList.union(keepKeys);
    }

    this.entries = this.entries.filter((value, key) => keepList.has(key));
  }
}

module.exports = { Aggregator, defaultMapper, defaultEnricher };
