const { is, Set } = require('immutable');

const api = require('../app/api');
const { Aggregator, lastSeen } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const {
  aggregateCount,
  aggregateSum,
  formatDuration,
  md5,
} = require('../lib/util');

const { agentFormat } = require('./agent');

const identityHeaders = {
  accept: 'Accept',
  'accept-charset': 'Accept-Charset',
  // 'accept-encoding': 'Accept-Encoding',
  'accept-language': 'Accept-Language',
  dnt: 'Dnt',
  from: 'From',
  'user-agent': 'User-Agent',
};

function normalisedIdentityHeader(headers) {
  const lowerCaseHeaders = {};
  Object.keys(headers).forEach((key) => {
    lowerCaseHeaders[key.toLowerCase()] = headers[key];
  });

  const obj = {};
  Object.keys(identityHeaders).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(lowerCaseHeaders, key)) {
      const normalisedKey = identityHeaders[key];
      obj[normalisedKey] = lowerCaseHeaders[key];
    }
  });

  return obj;
}

function computeSignature(headers) {
  const string = Object.keys(headers)
    .map((key) => [key, headers[key]].join(':'))
    .join(';');

  return md5(`${string};`);
}

function augment(log) {
  const headers = log.getIn(['request', 'headers']).toJS();

  const identityHeaders = normalisedIdentityHeader(headers);

  const signature = computeSignature(identityHeaders);

  log = log.setIn(['signature', 'id'], signature);
  log = log.setIn(['signature', 'headers'], identityHeaders);

  return log;
}

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

let _aggregator;

function start() {
  const aggregator = (_aggregator = new Aggregator());

  aggregator.setIdentifier((log) => log.getIn(['signature', 'id']));

  const signatureFormatter = new Formatter();

  signatureFormatter.setFormats([
    ['signature', (entry) => entry.getIn(['signature', 'id'])],
    ['identity', (entry) => entry.get('identity')],
    ['addressCount', (entry) => entry.get('addresses').size],
    [
      'addresses',
      (entry) =>
        entry
          .get('addresses')
          .map((address) => address.get('value'))
          .slice(0, 10)
          .join('<br>'),
    ],
    [
      'lastAddress',
      (entry) => {
        const addr = entry.get('lastAddress');
        if (!addr) {
          return '';
        }
        return addr.get('hostname') || addr.get('value') || '';
      },
    ],

    [
      'headers',
      (entry) => {
        const headers = entry.getIn(['signature', 'headers']);
        return Object.entries(headers)
          .map((entry) => entry.join(':'))
          .join('<br>');
      },
    ],

    [
      'score',
      (entry) => {
        const s = entry.get('score');
        return typeof s === 'number' ? s.toFixed(1) : '—';
      },
    ],

    ['lastSeen', lastSeen],
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

    [
      'execTime15m',
      (entry) => formatDuration(aggregateSum(entry, 'per_minute')),
    ],
    ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],
  ]);

  signatureFormatter.insertFormat('agent', agentFormat, {
    before: 'count15m',
    color: 'grey',
  });

  aggregator.setFormatter(signatureFormatter);

  const enricher = (entry, log) => {
    for (const field of ['signature', 'identity', 'agent']) {
      if (log.has(field) && !is(log.get(field), entry.get(field))) {
        entry = entry.set(field, log.get(field));
      }
    }

    const fp = log.get('fingerprint');
    if (fp) {
      const score =
        typeof fp.score === 'number' ? fp.score : fp.get && fp.get('score');
      if (typeof score === 'number') {
        entry = entry.set('score', score);
      }
    }

    const address = log.get('address');
    entry = entry.set('lastAddress', address);
    if (!entry.has('addresses')) {
      entry = entry.set('addresses', new Set([address]));
    } else if (!entry.get('addresses').has(address)) {
      entry = entry.update('addresses', (set) => set.add(address));
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

  aggregator.sorters.ok15m = (entry) =>
    entry.getIn(['speed', 'ok_per_minute'])
      ? aggregateCount(entry, 'ok_per_minute')
      : 0;
  aggregator.sorters.ok24h = (entry) =>
    entry.getIn(['speed', 'ok_per_hour'])
      ? aggregateCount(entry, 'ok_per_hour')
      : 0;
  aggregator.sorters.err15m = (entry) =>
    entry.getIn(['speed', 'err_per_minute'])
      ? aggregateCount(entry, 'err_per_minute')
      : 0;
  aggregator.sorters.err24h = (entry) =>
    entry.getIn(['speed', 'err_per_hour'])
      ? aggregateCount(entry, 'err_per_hour')
      : 0;
  aggregator.sorters.addressCount = (entry) =>
    entry.has('addresses') ? entry.get('addresses').size : 0;
  aggregator.sorters.score = (entry) => {
    const s = entry.get('score');
    return typeof s === 'number' ? s : -1;
  };

  pipeline
    .getNode('main')
    .map((log) => aggregator.processLog(log), 'aggregator');

  api.registerAggregator('signatures', aggregator);
}

module.exports = {
  init,
  start,
  get aggregator() {
    return _aggregator;
  },
};
