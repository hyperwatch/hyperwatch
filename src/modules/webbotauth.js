// Verifies Web Bot Auth signatures (HTTP Message Signatures, RFC 9421) and
// sets webbotauth: { agent, keyid, verified, reason[, detail] } on signed
// requests.
// The identity module accepts a verified signature as a robot's proof.
//
// Keys of the known agents (src/data/webbotauth-agents.json) come from
// src/data/webbotauth-keys.json, then from their key directories, fetched
// when first needed, again when their max-age is over or a signature uses an
// unknown key (at most once a minute per agent). Other agents' directories
// are never fetched: their requests are marked "unknown agent".

const { fromJS } = require('immutable');

const api = require('../app/api');
const constants = require('../constants');
const agentsData = require('../data/webbotauth-agents.json');
const keysData = require('../data/webbotauth-keys.json');
const { Aggregator, lastSeen } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { aggregateCount, safeHtml } = require('../lib/util');
const { KeyStore, verify } = require('../lib/webbotauth');

/** @typedef {import('../types').Log} Log */

/** @type {KeyStore | undefined} */
let keyStore;

/** @returns {import('../types').ModuleConfig} */
function config() {
  return constants.modules.webbotauth || {};
}

/** @param {import('../lib/webbotauth').KeyStoreOptions} [options] */
function createKeyStore(options = {}) {
  return new KeyStore({
    agents: agentsData.map((entry) => entry.agent),
    committed: keysData,
    fetchKeys: config().fetch !== false,
    ...options,
  });
}

// For tests: another key store (agents, committed keys, fetch)
/** @param {KeyStore} store */
function setKeyStore(store) {
  keyStore = store;
}

// The hosts the client may have signed for (@authority): the Host header,
// and the public hosts it stands for behind a proxy, from
// modules.webbotauth.authorities ({ 'internal.example': 'example.com' }) or
// modules.webbotauth.authority (a function of the log, in JavaScript configs)
/**
 * @param {Log} log
 * @returns {string[]}
 */
function authoritiesOf(log) {
  // Without the default port of the request's scheme (https when unknown,
  // as for @scheme), other ports are part of the authority
  const scheme = log.getIn(['request', 'scheme']) || 'https';
  const defaultPort = scheme === 'http' ? ':80' : ':443';
  let host = String(
    log.getIn(['request', 'headers', 'host']) || ''
  ).toLowerCase();
  if (host.endsWith(defaultPort)) {
    host = host.slice(0, -defaultPort.length);
  }
  const { authority, authorities = {} } = config();
  const extra =
    typeof authority === 'function' ? authority(log) : authorities[host];
  return [...new Set([...[].concat(extra || []), host].filter(Boolean))];
}

/**
 * @param {Log} log
 * @returns {Promise<Log>}
 */
async function augment(log) {
  const request = log.get('request');
  const headers = request && request.get('headers');
  if (!headers || !headers.has('signature-input')) {
    return log;
  }
  if (!keyStore) {
    keyStore = createKeyStore();
  }
  const time = Date.parse(request.get('time'));
  let result;
  try {
    result = await verify(
      {
        method: request.get('method'),
        url: request.get('url'),
        scheme: request.get('scheme'),
        headers: headers.toJS(),
      },
      {
        keyStore,
        authorities: authoritiesOf(log),
        time: (Number.isFinite(time) ? time : Date.now()) / 1000,
      }
    );
  } catch (error) {
    // Never drop the log: a request Hyperwatch can't check is unverified
    result = { agent: null, keyid: null, verified: false, reason: 'error' };
  }
  return result ? log.set('webbotauth', fromJS(result)) : log;
}

function init() {
  pipeline.getNode('main').map(augment).registerNode('main');
}

/** @type {Aggregator | undefined} */
let _aggregator;

function start() {
  const aggregator = (_aggregator = new Aggregator());

  // One entry per agent and result
  aggregator.setIdentifier(
    (log) =>
      `${log.getIn(['webbotauth', 'agent']) || '-'} ${log.getIn([
        'webbotauth',
        'reason',
      ])} ${log.getIn(['webbotauth', 'detail']) || ''}`
  );

  aggregator.setEnricher((entry, log) => {
    entry = entry
      .set('webbotauth', log.get('webbotauth'))
      .set('lastAgent', log.getIn(['agent', 'family']) || '');
    return log.has('identity')
      ? entry.set('identity', log.get('identity'))
      : entry;
  });

  const formatter = new Formatter();
  formatter.setFormats([
    // Agents are https origins: the host is enough
    [
      'domain',
      (entry) =>
        /** @type {string} */ (
          entry.getIn(['webbotauth', 'agent']) || ''
        ).replace(/^https:\/\//, ''),
    ],
    // In HTML, a verified signature gets the ✓ of verified hostnames
    [
      'result',
      (entry, output) => {
        const reason = entry.getIn(['webbotauth', 'reason']) || '';
        return output === 'html' && reason === 'verified'
          ? safeHtml(
              '<span class="verified" title="Verified with a key the agent publishes">verified</span>'
            )
          : reason;
      },
    ],
    ['detail', (entry) => entry.getIn(['webbotauth', 'detail']) || ''],
    ['identity', (entry) => entry.get('identity') || ''],
    ['lastAgent', (entry) => entry.get('lastAgent') || ''],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],
    ['lastSeen', lastSeen],
  ]);
  aggregator.setFormatter(formatter);

  pipeline
    .getNode('main')
    .filter((log) => log.has('webbotauth'))
    .map((log) => aggregator.processLog(log), 'aggregator');

  // `detail` (why a signature is outside the Web Bot Auth profile) is long:
  // in JSON and CSV only (/webbotauth.json, /webbotauth.csv)
  api.registerAggregator('webbotauth', aggregator, {
    nav: true,
    columns: ['domain', 'result', 'identity', 'lastAgent', 'count', 'lastSeen'],
  });
}

module.exports = {
  augment,
  authoritiesOf,
  createKeyStore,
  init,
  setKeyStore,
  start,
  get aggregator() {
    return _aggregator;
  },
};
