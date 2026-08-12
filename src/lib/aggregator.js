const { Map, Set, fromJS, is } = require('immutable');

const { Formatter, address, identity } = require('../lib/formatter');
const { Speed } = require('../lib/speed');
const {
  aggregateCount,
  aggregateSum,
  formatDuration,
  md5,
} = require('../lib/util');

const lastSeen = (entry) => {
  const ts =
    entry.getIn(['speed', 'per_minute']) &&
    entry.getIn(['speed', 'per_minute']).latest;
  return ts ? new Date(ts * 1000).toISOString() : '';
};

const defaultFormatter = new Formatter();
defaultFormatter.setFormats([
  ['identity', identity],

  ['address', (entry) => entry.getIn(['address', 'value']) || ''],
  ['hostname', address],

  ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
  ['count24h', (entry) => aggregateCount(entry, 'per_hour')],

  [
    'ok15m',
    (entry) =>
      entry.getIn(['speed', 'ok_per_minute'])
        ? aggregateCount(entry, 'ok_per_minute')
        : 0,
  ],
  [
    'ok24h',
    (entry) =>
      entry.getIn(['speed', 'ok_per_hour'])
        ? aggregateCount(entry, 'ok_per_hour')
        : 0,
  ],
  [
    'err15m',
    (entry) =>
      entry.getIn(['speed', 'err_per_minute'])
        ? aggregateCount(entry, 'err_per_minute')
        : 0,
  ],
  [
    'err24h',
    (entry) =>
      entry.getIn(['speed', 'err_per_hour'])
        ? aggregateCount(entry, 'err_per_hour')
        : 0,
  ],

  ['execTime15m', (entry) => formatDuration(aggregateSum(entry, 'per_minute'))],
  ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],

  ['lastSeen', lastSeen],
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
  ok15m: (entry) =>
    entry.getIn(['speed', 'ok_per_minute'])
      ? aggregateCount(entry, 'ok_per_minute')
      : 0,
  ok24h: (entry) =>
    entry.getIn(['speed', 'ok_per_hour'])
      ? aggregateCount(entry, 'ok_per_hour')
      : 0,
  err15m: (entry) =>
    entry.getIn(['speed', 'err_per_minute'])
      ? aggregateCount(entry, 'err_per_minute')
      : 0,
  err24h: (entry) =>
    entry.getIn(['speed', 'err_per_hour'])
      ? aggregateCount(entry, 'err_per_hour')
      : 0,
  latest: (entry) => entry.getIn(['speed', 'per_minute']).latest,
  execTime15m: (entry) => aggregateSum(entry, 'per_minute'),
  execTime24h: (entry) => aggregateSum(entry, 'per_hour'),
};

class Aggregator {
  constructor() {
    this.entries = new Map();
    // Snapshot the default formats: modules extend defaultFormatter during
    // init, aggregators are created during start, and per-aggregator
    // insertFormat calls must not leak into other aggregators.
    this.formatter = defaultFormatter.clone();
    this.enricher = defaultEnricher;
    this.identifier = defaultIdentifier;
    this.sorters = { ...defaultSorters };
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

    const status = log.getIn(['response', 'status']);

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
        )
        .setIn([id, 'speed', 'ok_per_minute'], new Speed(60, 15))
        .setIn([id, 'speed', 'ok_per_hour'], new Speed(3600, 24))
        .setIn([id, 'speed', 'err_per_minute'], new Speed(60, 15))
        .setIn([id, 'speed', 'err_per_hour'], new Speed(3600, 24));
    } else {
      this.entries = this.entries
        .updateIn([id, 'speed', 'per_minute'], (speed) =>
          speed.hit(undefined, executionTime)
        )
        .updateIn([id, 'speed', 'per_hour'], (speed) =>
          speed.hit(undefined, executionTime)
        );
    }

    if (status >= 200 && status < 300) {
      this.entries = this.entries
        .updateIn([id, 'speed', 'ok_per_minute'], (speed) => speed.hit())
        .updateIn([id, 'speed', 'ok_per_hour'], (speed) => speed.hit());
    } else if (status >= 400 && status < 500) {
      this.entries = this.entries
        .updateIn([id, 'speed', 'err_per_minute'], (speed) => speed.hit())
        .updateIn([id, 'speed', 'err_per_hour'], (speed) => speed.hit());
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

    const sorted = this.entries.map(this.sorters[sort]).sort().reverse();
    const rawData = sorted
      .slice(0, limit || 100)
      .keySeq()
      .map((id) => this.entries.get(id));

    const output = format === 'json' ? 'text' : 'html';

    return raw
      ? rawData
      : rawData.map((entry) => this.formatter.formatObject(entry, output));
  }

  reset() {
    this.entries = new Map();
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
        plain.speed = entry
          .get('speed')
          .map((speed) => speed.toJSON())
          .toObject();
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
      // and addresses/signatures must be Sets, not Lists — fix after conversion.
      let entry = fromJS(rest);
      if (entry.hasIn(['signature', 'headers'])) {
        entry = entry.setIn(['signature', 'headers'], rest.signature.headers);
      }
      if (entry.has('addresses')) {
        entry = entry.update('addresses', (list) => Set(list));
      }
      if (entry.has('signatures')) {
        entry = entry.update('signatures', (list) => Set(list));
      }
      entry = entry
        .setIn(['speed', 'per_minute'], Speed.fromJSON(speed.per_minute))
        .setIn(['speed', 'per_hour'], Speed.fromJSON(speed.per_hour))
        .setIn(
          ['speed', 'ok_per_minute'],
          speed.ok_per_minute
            ? Speed.fromJSON(speed.ok_per_minute)
            : new Speed(60, 15)
        )
        .setIn(
          ['speed', 'ok_per_hour'],
          speed.ok_per_hour
            ? Speed.fromJSON(speed.ok_per_hour)
            : new Speed(3600, 24)
        )
        .setIn(
          ['speed', 'err_per_minute'],
          speed.err_per_minute
            ? Speed.fromJSON(speed.err_per_minute)
            : new Speed(60, 15)
        )
        .setIn(
          ['speed', 'err_per_hour'],
          speed.err_per_hour
            ? Speed.fromJSON(speed.err_per_hour)
            : new Speed(3600, 24)
        );
      this.entries = this.entries.set(rest.id, entry);
    }
  }
}

module.exports = { Aggregator, defaultFormatter, defaultEnricher, lastSeen };
