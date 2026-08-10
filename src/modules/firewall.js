const fs = require('fs');
const path = require('path');

const IPCIDR = require('ip-cidr').default;

const api = require('../app/api');
const constants = require('../constants');
const { Aggregator } = require('../lib/aggregator');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');
const { aggregateCount, aggregateSum, formatDuration } = require('../lib/util');

const address = require('./address');
const signature = require('./signature');

let rules = [];

function loadRules() {
  const filePath =
    (constants.modules.firewall && constants.modules.firewall.path) ||
    path.join(process.cwd(), 'firewall.json');

  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    rules = (data.rules || []).map((rule) => {
      if (rule.match && rule.match.ua_regex) {
        rule._ua_regex = new RegExp(rule.match.ua_regex);
      }
      return rule;
    });
  } catch (err) {
    console.warn(`firewall: could not load ${filePath}: ${err.message}`);
    rules = [];
  }
}

function matchRule(log, rule) {
  const match = rule.match;
  if (!match) {
    return false;
  }

  if (match.address) {
    const address =
      log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
    if (address !== match.address) {
      return false;
    }
  }

  if (match.addresses) {
    const address =
      log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
    if (!match.addresses.includes(address)) {
      return false;
    }
  }

  if (match.cidrs) {
    const address =
      log.getIn(['address', 'value']) || log.getIn(['request', 'address']);
    if (
      !address ||
      !match.cidrs.some((cidr) => new IPCIDR(cidr).contains(address))
    ) {
      return false;
    }
  }

  if (match.asns) {
    const asnNumber = log.getIn(['asn', 'number']);
    if (!asnNumber || !match.asns.includes(asnNumber)) {
      return false;
    }
  }

  if (match.identity) {
    if (log.get('identity') !== match.identity) {
      return false;
    }
  }

  if (match.no_identity) {
    if (log.has('identity')) {
      return false;
    }
  }

  if (match.signature) {
    if (log.getIn(['signature', 'id']) !== match.signature) {
      return false;
    }
  }

  if (match.signatures) {
    if (!match.signatures.includes(log.getIn(['signature', 'id']))) {
      return false;
    }
  }

  if (match.headers) {
    for (const [header, value] of Object.entries(match.headers)) {
      if (log.getIn(['request', 'headers', header]) !== value) {
        return false;
      }
    }
  }

  if (match.headers_contain) {
    for (const [header, value] of Object.entries(match.headers_contain)) {
      const actual = log.getIn(['request', 'headers', header]) || '';
      if (!actual.includes(value)) {
        return false;
      }
    }
  }

  if (match.cookie_contains) {
    const cookie = log.getIn(['request', 'headers', 'cookie']) || '';
    if (!cookie.includes(match.cookie_contains)) {
      return false;
    }
  }

  if (match.missing_headers) {
    for (const header of match.missing_headers) {
      if (log.hasIn(['request', 'headers', header])) {
        return false;
      }
    }
  }

  if (match.min_fingerprint_score !== undefined) {
    const score = log.getIn(['fingerprint', 'score']) || 0;
    if (score < match.min_fingerprint_score) {
      return false;
    }
  }

  if (match.user_agents) {
    const ua = log.getIn(['request', 'headers', 'user-agent']) || '';
    if (!match.user_agents.includes(ua)) {
      return false;
    }
  }

  if (rule._ua_regex) {
    const ua = log.getIn(['request', 'headers', 'user-agent']) || '';
    if (!rule._ua_regex.test(ua)) {
      return false;
    }
  }

  return true;
}

function augment(log) {
  for (const rule of rules) {
    if (matchRule(log, rule)) {
      return log.set('firewall', {
        action: rule.action,
        rule: rule.id,
        reason: rule.reason,
        explicit: !!(rule.match.address || rule.match.addresses),
      });
    }
  }
  return log;
}

function init() {
  loadRules();

  // Watch for changes to the rules file
  const filePath =
    (constants.modules.firewall && constants.modules.firewall.path) ||
    path.join(process.cwd(), 'firewall.json');

  fs.watchFile(filePath, { interval: 5000 }, () => {
    console.log('firewall: reloading rules');
    loadRules();
  });

  pipeline.getNode('main').map(augment).registerNode('main');
}

function start() {
  const aggregator = new Aggregator();

  aggregator.setIdentifier((log) => log.getIn(['firewall', 'rule']));

  const firewallFormatter = new Formatter();

  firewallFormatter.setFormats([
    ['rule', (entry) => entry.getIn(['firewall', 'rule'])],
    ['action', (entry) => entry.getIn(['firewall', 'action'])],
    ['reason', (entry) => entry.getIn(['firewall', 'reason'])],
    [
      'cloudflare',
      (entry) => {
        const ruleId = entry.getIn(['firewall', 'rule']);
        const rule = rules.find((r) => r.id === ruleId);
        return rule && rule.cloudflare ? rule.cloudflare.id : '';
      },
    ],
    ['count15m', (entry) => aggregateCount(entry, 'per_minute')],
    ['count24h', (entry) => aggregateCount(entry, 'per_hour')],
    [
      'execTime15m',
      (entry) => formatDuration(aggregateSum(entry, 'per_minute')),
    ],
    ['execTime24h', (entry) => formatDuration(aggregateSum(entry, 'per_hour'))],
  ]);

  aggregator.setFormatter(firewallFormatter);

  const enricher = (entry, log) => {
    if (log.has('firewall') && !entry.has('firewall')) {
      entry = entry.set('firewall', log.get('firewall'));
    }
    return entry;
  };

  aggregator.setEnricher(enricher);

  pipeline.getNode('main').map((log) => {
    if (log.has('firewall')) {
      aggregator.processLog(log);
    }
    return log;
  }, 'aggregator');

  api.registerAggregator('firewall', aggregator);

  // Inject firewall columns into address aggregator
  address.aggregator.formatter.insertFormat('firewall', firewallFormat);
  address.aggregator.formatter.insertFormat(
    'firewallRule',
    addressFirewallRuleFormat
  );

  // Inject firewall columns into signature aggregator
  signature.aggregator.formatter.insertFormat(
    'firewall',
    signatureFirewallFormat
  );
  signature.aggregator.formatter.insertFormat(
    'firewallRule',
    signatureFirewallRuleFormat
  );
}

function getExplicitAction(address) {
  for (const rule of rules) {
    if (rule.match.address === address) {
      return rule.action;
    }
    if (rule.match.addresses && rule.match.addresses.includes(address)) {
      return rule.action;
    }
  }
  return null;
}

function getSignatureAction(sig) {
  for (const rule of rules) {
    if (rule.match.signature === sig) {
      return rule.action;
    }
    if (rule.match.signatures && rule.match.signatures.includes(sig)) {
      return rule.action;
    }
  }
  return null;
}

const firewallFormat = (entry) =>
  getExplicitAction(entry.getIn(['address', 'value'])) || '';

const addressFirewallRuleFormat = (entry) => {
  const addr = entry.getIn(['address', 'value']);
  for (const rule of rules) {
    if (rule.match.address === addr) {
      return rule.id;
    }
    if (rule.match.addresses && rule.match.addresses.includes(addr)) {
      return rule.id;
    }
  }
  return '';
};

const signatureFirewallFormat = (entry) => {
  const fw = entry.get('firewall');
  if (fw) {
    const action =
      typeof fw === 'object' && fw.action
        ? fw.action
        : fw.get && fw.get('action');
    if (action) {
      return action;
    }
  }
  return getSignatureAction(entry.getIn(['signature', 'id'])) || '';
};

const signatureFirewallRuleFormat = (entry) => {
  const fw = entry.get('firewall');
  if (fw) {
    return (
      (typeof fw === 'object' && fw.rule
        ? fw.rule
        : fw.get && fw.get('rule')) || ''
    );
  }
  return '';
};

module.exports = { init, start, getExplicitAction, getSignatureAction };
