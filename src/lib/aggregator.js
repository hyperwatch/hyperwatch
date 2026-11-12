const { List, Map, Set, fromJS, is } = require('immutable');

const { Formatter, address, identity } = require('../lib/formatter');
const { Speed } = require('../lib/speed');
const {
  aggregateCount,
  aggregateSum,
  formatDuration,
  md5,
  safeHtml,
} = require('../lib/util');

// ISO 8601 in text (JSON, CSV), shorter in HTML and on one line:
// 2026-09-25 12:51:07
/** @type {import('./formatter').Format} */
const lastSeen = (entry, output) => {
  const ts =
    /** @type {Speed | undefined} */ (entry.getIn(['speed', 'per_minute'])) &&
    /** @type {Speed} */ (entry.getIn(['speed', 'per_minute'])).latest;
  if (!ts) {
    return '';
  }
  const iso = new Date(ts * 1000).toISOString();
  return output === 'html'
    ? safeHtml(iso.slice(0, 19).replace('T', '&nbsp;'))
    : iso;
};

// The hits of the speed `key` of an entry, 0 if it has none
/**
 * @param {string} key
 * @returns {Sorter}
 */
const statusCount = (key) => (entry) =>
  entry.getIn(['speed', key]) ? aggregateCount(entry, key) : 0;

const defaultFormatter = new Formatter();
defaultFormatter.setFormats([
  ['identity', identity],

  ['address', (entry) => entry.getIn(['address', 'value']) || ''],
  ['hostname', address],

  ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
  ['count24h', (entry) => aggregateCount(entry, 'per_hour')],

  ['2xx15m', statusCount('2xx_per_minute')],
  ['2xx24h', statusCount('2xx_per_hour')],
  ['4xx15m', statusCount('4xx_per_minute')],
  ['4xx24h', statusCount('4xx_per_hour')],

  ['execTime15m', (entry) => formatDuration(aggregateSum(entry, 'per_minute'))],
  ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],

  ['lastSeen', lastSeen],
]);
// The hostname is the highlight of the tables, the address plain
defaultFormatter.colors.hostname = defaultFormatter.colors.address;
delete defaultFormatter.colors.address;

/** @type {Enricher} */
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

/** @type {Identifier} */
const defaultIdentifier = (log) => {
  return (
    log.getIn(['identity']) ||
    log.getIn(['address', 'value']) ||
    log.getIn(['request', 'address'])
  );
};

/** @type {Record<string, Sorter>} */
const defaultSorters = {
  count15m: (entry) => aggregateCount(entry, 'per_minute'),
  count24h: (entry) => aggregateCount(entry, 'per_hour'),
  '2xx15m': statusCount('2xx_per_minute'),
  '2xx24h': statusCount('2xx_per_hour'),
  '4xx15m': statusCount('4xx_per_minute'),
  '4xx24h': statusCount('4xx_per_hour'),
  latest: (entry) =>
    /** @type {Speed} */ (entry.getIn(['speed', 'per_minute'])).latest,
  execTime15m: (entry) => aggregateSum(entry, 'per_minute'),
  execTime24h: (entry) => aggregateSum(entry, 'per_hour'),
};

class Aggregator {
  constructor() {
    /** @type {Map<string, Entry>} Entries by md5 of their identifier */
    this.entries = Map();
    // Snapshot the default formats: modules extend defaultFormatter during
    // init, aggregators are created during start, and per-aggregator
    // insertFormat calls must not leak into other aggregators.
    this.formatter = defaultFormatter.clone();
    /** @type {Enricher} */
    this.enricher = defaultEnricher;
    /** @type {Identifier} */
    this.identifier = defaultIdentifier;
    /** @type {Record<string, Sorter>} */
    this.sorters = { ...defaultSorters };
    /** @type {((entry: Entry) => Entry) | null} */
    this.entryGc = null;
    this.gcSize = 1000;

    setInterval(() => this.gc(), 60 * 1000).unref();
  }

  /**
   * @param {Formatter} fn
   * @returns {this}
   */
  setFormatter(fn) {
    this.formatter = fn;

    return this;
  }

  /**
   * @param {Enricher} fn
   * @returns {this}
   */
  setEnricher(fn) {
    this.enricher = fn;

    return this;
  }

  // Per-entry cleanup run on every gc pass, regardless of aggregator size
  /**
   * @param {(entry: Entry) => Entry} fn
   * @returns {this}
   */
  setEntryGc(fn) {
    this.entryGc = fn;

    return this;
  }

  /**
   * fn(log): the key of the log's entry, a string. Logs it returns
   * undefined or null for (a field missing on that log) are left out, like
   * by() does in the pipeline
   * @param {Identifier} fn
   * @returns {this}
   */
  setIdentifier(fn) {
    this.identifier = fn;

    return this;
  }

  /**
   * Counts a log in the entry of its identifier
   * @param {Log} log
   * @returns {Log}
   */
  processLog(log) {
    const identifier = this.identifier(log);
    if (identifier === undefined || identifier === null) {
      return log;
    }
    const id = md5(identifier);
    const rawExecTime = Number(log.get('executionTime'));
    const executionTime = Number.isFinite(rawExecTime) ? rawExecTime : 0;

    const status = /** @type {number} */ (log.getIn(['response', 'status']));

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
        .setIn([id, 'speed', '2xx_per_minute'], new Speed(60, 15))
        .setIn([id, 'speed', '2xx_per_hour'], new Speed(3600, 24))
        .setIn([id, 'speed', '4xx_per_minute'], new Speed(60, 15))
        .setIn([id, 'speed', '4xx_per_hour'], new Speed(3600, 24));
    } else {
      this.entries = this.entries
        .updateIn([id, 'speed', 'per_minute'], (/** @type {any} */ speed) =>
          speed.hit(undefined, executionTime)
        )
        .updateIn([id, 'speed', 'per_hour'], (/** @type {any} */ speed) =>
          speed.hit(undefined, executionTime)
        );
    }

    if (status >= 200 && status < 300) {
      this.entries = this.entries
        .updateIn([id, 'speed', '2xx_per_minute'], (/** @type {any} */ speed) =>
          speed.hit()
        )
        .updateIn([id, 'speed', '2xx_per_hour'], (/** @type {any} */ speed) =>
          speed.hit()
        );
    } else if (status >= 400 && status < 500) {
      this.entries = this.entries
        .updateIn([id, 'speed', '4xx_per_minute'], (/** @type {any} */ speed) =>
          speed.hit()
        )
        .updateIn([id, 'speed', '4xx_per_hour'], (/** @type {any} */ speed) =>
          speed.hit()
        );
    }

    this.entries = this.entries.updateIn([id], (entry) =>
      this.enricher(/** @type {Entry} */ (entry), log)
    );

    return log;
  }

  /**
   * @param {string} id
   * @returns {Entry | undefined}
   */
  get(id) {
    return this.entries.get(id);
  }

  // filter(entry): only keep the matching entries, before sorting and limiting
  /**
   * The entries, sorted by `sort` (descending), formatted unless `raw`
   * @param {GetDataOptions} options
   * @returns {import('immutable').Seq.Indexed<Entry | Record<string, any>>}
   */
  getData({ raw, sort, format, limit, filter }) {
    if (!sort || !this.sorters[sort]) {
      sort = 'count15m';
    }

    const entries = filter ? this.entries.filter(filter) : this.entries;
    const sorted = entries.map(this.sorters[sort]).sort().reverse();
    const rawData = sorted
      .slice(0, limit || 100)
      .keySeq()
      .map((id) => /** @type {Entry} */ (this.entries.get(id)));

    const output = format === 'json' ? 'text' : 'html';

    return raw
      ? rawData
      : rawData.map((entry) => this.formatter.formatObject(entry, output));
  }

  reset() {
    this.entries = Map();
  }

  gc() {
    if (this.entryGc) {
      this.entries = this.entries.map(this.entryGc);
    }

    if (this.entries.size < this.gcSize) {
      return;
    }

    let keepList = Set();
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

  /** @returns {Record<string, any>[]} The entries, for persistence */
  dump() {
    return this.entries
      .map((entry) => {
        const plain = entry.toJS();
        plain.speed = entry
          .get('speed')
          .map((/** @type {any} */ speed) => speed.toJSON())
          .toObject();
        return plain;
      })
      .valueSeq()
      .toArray();
  }

  /** @param {Record<string, any>[]} data Entries as dump() gives them */
  load(data) {
    for (const item of data) {
      const { speed, ...rest } = item;
      // fromJS deep-converts everything to Immutable structures.
      // Signature headers must stay as a plain object (used with Object.entries).
      let entry = /** @type {Entry} */ (fromJS(rest));
      if (entry.hasIn(['signature', 'headers'])) {
        entry = entry.setIn(['signature', 'headers'], rest.signature.headers);
      }
      // addresses/signatures are Map<id, lastSeen>. Dumps from before that
      // stored plain arrays, which the enrichers can't update — discard them
      // and let the counts rebuild from live traffic.
      for (const key of ['addresses', 'signatures']) {
        if (List.isList(entry.get(key))) {
          entry = entry.delete(key);
        }
      }
      entry = entry
        .setIn(['speed', 'per_minute'], Speed.fromJSON(speed.per_minute))
        .setIn(['speed', 'per_hour'], Speed.fromJSON(speed.per_hour))
        .setIn(
          ['speed', '2xx_per_minute'],
          speed['2xx_per_minute']
            ? Speed.fromJSON(speed['2xx_per_minute'])
            : new Speed(60, 15)
        )
        .setIn(
          ['speed', '2xx_per_hour'],
          speed['2xx_per_hour']
            ? Speed.fromJSON(speed['2xx_per_hour'])
            : new Speed(3600, 24)
        )
        .setIn(
          ['speed', '4xx_per_minute'],
          speed['4xx_per_minute']
            ? Speed.fromJSON(speed['4xx_per_minute'])
            : new Speed(60, 15)
        )
        .setIn(
          ['speed', '4xx_per_hour'],
          speed['4xx_per_hour']
            ? Speed.fromJSON(speed['4xx_per_hour'])
            : new Speed(3600, 24)
        );
      this.entries = this.entries.set(rest.id, entry);
    }
    // Drop members that went stale while the process was down
    if (this.entryGc) {
      this.entries = this.entries.map(this.entryGc);
    }
  }
}

/**
 * An entry of an aggregator: `id`, `identifier`, `speed` (a Map of Speed by
 * window: `per_minute`, `per_hour`, `2xx_per_minute`…) and what the enricher
 * copies from the logs
 * @typedef {import('immutable').Map<string, any>} Entry
 */

/**
 * The key of a log's entry (hashed with md5)
 * @typedef {(log: Log) => any} Identifier
 */

/**
 * Updates an entry with a log of it
 * @typedef {(entry: Entry, log: Log) => Entry} Enricher
 */

/**
 * The value an entry is sorted by (descending)
 * @typedef {(entry: Entry) => any} Sorter
 */

/**
 * @typedef {object} GetDataOptions
 * @property {boolean} [raw] The entries, not formatted
 * @property {string} [sort] A key of `sorters`, `count15m` by default
 * @property {string | null} [format] `json` for text, HTML otherwise
 * @property {number} [limit] 100 by default
 * @property {(entry: Entry, id: string) => boolean} [filter]
 */

/** @typedef {import('../types').Log} Log */

module.exports.Aggregator = Aggregator;
module.exports.defaultFormatter = defaultFormatter;
module.exports.defaultEnricher = defaultEnricher;
module.exports.lastSeen = lastSeen;
module.exports.statusCount = statusCount;
