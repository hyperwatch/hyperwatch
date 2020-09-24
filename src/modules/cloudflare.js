const { trim } = require('lodash');
const fetch = require('node-fetch');

const api = require('../app/api');
const aggregator = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

const {
  CLOUDFLARE_ZONE_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_BLOCK_RULE_ID,
} = process.env;

function getConnectingIp(log) {
  return log.getIn(['request', 'headers', 'cf-connecting-ip']);
}

function getIpCountry(log) {
  return log.getIn(['request', 'headers', 'cf-ipcountry']);
}

function getDataCenter(log) {
  const cfRay = log.getIn(['request', 'headers', 'cf-ray']);
  if (cfRay) {
    const [, dataCenter] = cfRay.split('-');
    return dataCenter;
  }
}

function apiConfigured() {
  return CLOUDFLARE_ZONE_ID && CLOUDFLARE_API_TOKEN;
}

async function fetchFromApi(path, options = {}) {
  const url = `https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}${path}`;

  options.headers = options.headers || {};
  options.headers.authorization = `Bearer ${CLOUDFLARE_API_TOKEN}`;

  const result = await fetch(url, options);

  const json = await result.json();

  return json.result;
}

function augment(log) {
  const connectingIp = getConnectingIp(log);
  if (connectingIp) {
    log = log.setIn(['address', 'value'], connectingIp);
  }

  const ipCountry = getIpCountry(log);
  if (ipCountry) {
    log = log.setIn(['address', 'country-code'], ipCountry);
  }

  const dataCenter = getDataCenter(log);
  if (dataCenter) {
    log = log.setIn(['cloudflare', 'data-center'], dataCenter);
  }

  return log;
}

let blockedAddresses, blockRule;

async function loadBlockedAddresses() {
  if (!apiConfigured() || !CLOUDFLARE_BLOCK_RULE_ID) {
    return;
  }

  blockRule = await fetchFromApi(`/firewall/rules/${CLOUDFLARE_BLOCK_RULE_ID}`);

  // (ip.src eq 119.160.101.131) or (ip.src eq 39.53.249.2) or (ip.src eq 103.203.254.38)
  blockedAddresses = blockRule.filter.expression
    .split(' or ')
    .map((s) => trim(s, ' ()').split(' eq ')[1]);

  return blockedAddresses;
}

async function updateBlockedAddresses(blockedAddresses) {
  const expression = blockedAddresses
    .map((address) => `(ip.src eq ${address})`)
    .join(' or ');

  const payload = {
    id: blockRule.filter.id,
    expression,
    paused: false,
  };

  await fetchFromApi(`/filters/${blockRule.filter.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function loadApiRoutes() {
  api.post(`/cloudflare/blockAddress`, async (req, res) => {
    blockedAddresses = await loadBlockedAddresses();
    blockedAddresses.push(req.body.address);
    updateBlockedAddresses(blockedAddresses);
    // Optimistic
    res.redirect(req.headers.referer);
  });
  api.post(`/cloudflare/unblockAddress`, async (req, res) => {
    blockedAddresses = await loadBlockedAddresses();
    blockedAddresses = blockedAddresses.filter((el) => el !== req.body.address);
    updateBlockedAddresses(blockedAddresses);
    // Optimistic
    res.redirect(req.headers.referer);
  });
}

async function load() {
  loadBlockedAddresses();

  loadApiRoutes();

  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('block', (entry) => {
    const address = entry.getIn(['address', 'value']);
    if (address) {
      const [url, label] = blockedAddresses.includes(address)
        ? ['/cloudflare/unblockAddress', 'Unblock']
        : ['/cloudflare/blockAddress', 'Block'];
      return `<form method="POST" action="${url}"><input type="hidden" name="address" value="${address}"/><input type="submit" value="${label}"/></form>`;
    }
  });
}

module.exports = {
  augment,
  load,
};
