const { is } = require('immutable');

const api = require('../app/api');
const { Aggregator, lastSeen, statusCount } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { touch, prune, countRecent } = require('../lib/recent-map');
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

const addressCount15m = (entry) => countRecent(entry.get('addresses'), 15 * 60);
const addressCount24h = (entry) => countRecent(entry.get('addresses'));

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
    ['addressCount15m', addressCount15m],
    ['addressCount24h', addressCount24h],
    [
      'addresses',
      (entry) =>
        entry.has('addresses')
          ? entry.get('addresses').keySeq().slice(0, 10).join('<br>')
          : '',
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

    ['lastSeen', lastSeen],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],

    ['2xx15m', statusCount('2xx_per_minute')],
    ['2xx24h', statusCount('2xx_per_hour')],
    ['4xx15m', statusCount('4xx_per_minute')],
    ['4xx24h', statusCount('4xx_per_hour')],

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

    const address = log.get('address');
    entry = entry.set('lastAddress', address);
    // Distinct IPs with last-seen time, pruned to 24h; backs both the 15m
    // and 24h counts
    const value = address && address.get('value');
    if (value) {
      entry = entry.update('addresses', (map) => touch(map, value));
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

  aggregator.setEntryGc((entry) =>
    entry.has('addresses') ? entry.update('addresses', prune) : entry
  );

  aggregator.sorters.addressCount15m = addressCount15m;
  aggregator.sorters.addressCount24h = addressCount24h;

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
