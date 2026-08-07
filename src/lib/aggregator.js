const { Map, Set, fromJS, is } = require('immutable');

const { Formatter, address, identity } = require('../lib/formatter');
const { Speed } = require('../lib/speed');
const {
  aggregateCount,
  aggregateSum,
  formatDuration,
  md5,
} = require('../lib/util');

const defaultFormatter = new Formatter();
defaultFormatter.setFormats([
  ['identity', identity],

  ['address', address],

  ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
  ['count24h', (entry) => aggregateCount(entry, 'per_hour')],

  ['execTime15m', (entry) => formatDuration(aggregateSum(entry, 'per_minute'))],
  ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],
]);

const defaultEnricher = (entry, log) => {
  for (const field of [
    'address',
    'identity',
    'cloudflare',
    'dnsbl',
    'geoip',
    'hostname',
    'agent',
    'language',
    'signature',
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
  count15m: (entry) => aggregateCount(entry, 'per_minute'),
  count24h: (entry) => aggregateCount(entry, 'per_hour'),
  latest: (entry) => entry.getIn(['speed', 'per_minute']).latest,
  execTime15m: (entry) => aggregateSum(entry, 'per_minute'),
  execTime24h: (entry) => aggregateSum(entry, 'per_hour'),
};

class Aggregator {
  constructor() {
    this.entries = new Map();
    this.formatter = defaultFormatter;
    this.enricher = defaultEnricher;
    this.identifier = defaultIdentifier;
    this.sorters = defaultSorters;
    this.gcSize = 1000;

    setInterval(() => this.gc(), 60 * 1000).unref();
  }

  setFormatter(fn) {
    this.formatter = fn;

    return this;
  }

  setEnricher(fn) {
    this.enricher = fn;

    return this;
  }

  setIdentifier(fn) {
    this.identifier = fn;

    return this;
  }

  processLog(log) {
    const identifier = this.identifier(log);
    const id = md5(identifier);
    const rawExecTime = Number(log.get('executionTime'));
    const executionTime = Number.isFinite(rawExecTime) ? rawExecTime : 0;

    if (!this.entries.has(id)) {
      this.entries = this.entries
        .setIn([id, 'id'], id)
        .setIn([id, 'identifier'], identifier)
        .setIn(
          [id, 'speed', 'per_minute'],
          new Speed(60, 15).hit(undefined, executionTime)
        )
        .setIn(
          [id, 'speed', 'per_hour'],
          new Speed(3600, 24).hit(undefined, executionTime)
        );
    } else {
      this.entries = this.entries
        .updateIn([id, 'speed', 'per_minute'], (speed) =>
          speed.hit(undefined, executionTime)
        )
        .updateIn([id, 'speed', 'per_hour'], (speed) =>
          speed.hit(undefined, executionTime)
        );
    }

    this.entries = this.entries.updateIn([id], (entry) =>
      this.enricher(entry, log)
    );

    return log;
  }

  get(id) {
    return this.entries.get(id);
  }

  getData({ raw, sort, format, limit }) {
    if (!sort || !this.sorters[sort]) {
      sort = 'count15m';
    }

    const rawData = this.entries
      .map(this.sorters[sort])
      .sort()
      .reverse()
      .slice(0, limit || 100)
      .keySeq()
      .map((id) => this.entries.get(id));

    const output = format === 'json' ? 'text' : 'html';

    return raw
      ? rawData
      : rawData.map((entry) => this.formatter.formatObject(entry, output));
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

  dump() {
    return this.entries
      .map((entry) => {
        const plain = entry.toJS();
        plain.speed = {
          per_minute: entry.getIn(['speed', 'per_minute']).toJSON(),
          per_hour: entry.getIn(['speed', 'per_hour']).toJSON(),
        };
        return plain;
      })
      .valueSeq()
      .toArray();
  }

  load(data) {
    for (const item of data) {
      const { speed, ...rest } = item;
      // fromJS deep-converts everything to Immutable structures.
      // Signature headers must stay as a plain object (used with Object.entries),
      // and addresses must be a Set, not a List — fix both after conversion.
      let entry = fromJS(rest);
      if (entry.hasIn(['signature', 'headers'])) {
        entry = entry.setIn(['signature', 'headers'], rest.signature.headers);
      }
      if (entry.has('addresses')) {
        entry = entry.update('addresses', (list) => Set(list));
      }
      entry = entry
        .setIn(['speed', 'per_minute'], Speed.fromJSON(speed.per_minute))
        .setIn(['speed', 'per_hour'], Speed.fromJSON(speed.per_hour));
      this.entries = this.entries.set(rest.id, entry);
    }
  }
}

module.exports = { Aggregator, defaultFormatter, defaultEnricher };
