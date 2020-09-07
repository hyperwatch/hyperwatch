const { is, Set } = require('immutable');

const api = require('../app/api');
const { Aggregator } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { aggregateSpeed, md5 } = require('../lib/util');

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

function load() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

function beforeStart() {
  const aggregator = new Aggregator();

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
      'headers',
      (entry) => {
        const headers = entry.getIn(['signature', 'headers']);
        return Object.entries(headers)
          .map((entry) => entry.join(':'))
          .join('<br>');
      },
    ],

    ['15m', (entry) => aggregateSpeed(entry, 'per_minute')],
    ['24h', (entry) => aggregateSpeed(entry, 'per_hour')],
  ]);

  signatureFormatter.insertFormat('agent', agentFormat, {
    before: '15m',
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
    if (!entry.has('addresses')) {
      entry = entry.set('addresses', new Set([address]));
    } else if (!entry.get('addresses').has(address)) {
      entry = entry.update('addresses', (set) => set.add(address));
    }

    return entry;
  };

  aggregator.setEnricher(enricher);

  pipeline.getNode('main').map((log) => aggregator.processLog(log));

  api.registerAggregator('signatures', aggregator);
}

module.exports = {
  load,
  beforeStart,
};
