const { trim } = require('lodash');
const fetch = require('node-fetch');

const api = require('../app/api');
const aggregator = require('../lib/aggregator');
const pipeline = require('../lib/pipeline');

const {
  CLOUDFLARE_ZONE_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_BLOCK_RULE_ID,
  CLOUDFLARE_BLOCK_USER_AGENTS_RULE_ID,
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

let blockedAddresses, blockRule, blockedUserAgents, blockUserAgentsRule;

async function loadBlockedAddresses() {
  if (!apiConfigured() || !CLOUDFLARE_BLOCK_RULE_ID) {
    return;
  }

  blockRule = await fetchFromApi(`/firewall/rules/${CLOUDFLARE_BLOCK_RULE_ID}`);

  // (ip.src eq 119.160.101.131) or (ip.src eq 39.53.249.2) or (ip.src eq 103.203.254.38)
  blockedAddresses = blockRule.filter.expression
    .split(' or ')
    .map((s) => trim(s, ' ()').split(' eq ')[1]);

  console.log({ blockedAddresses });

  return blockedAddresses;
}

async function loadBlockedUserAgents() {
  if (!apiConfigured() || !CLOUDFLARE_BLOCK_USER_AGENTS_RULE_ID) {
    return;
  }

  blockUserAgentsRule = await fetchFromApi(
    `/firewall/rules/${CLOUDFLARE_BLOCK_USER_AGENTS_RULE_ID}`
  );

  blockedUserAgents = blockUserAgentsRule.filter.expression
    .split(' or ')
    .map((s) => trim(s, ' ()').split(' eq ')[1])
    .map((s) => trim(s, '"'));

  console.log({ blockedUserAgents });

  return blockedUserAgents;
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

  console.log({ payload });

  const result = await fetchFromApi(`/filters/${blockRule.filter.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  console.log(result);
}

async function updateBlockedUserAgents(blockedUserAgents) {
  const expression = blockedUserAgents
    .map((userAgent) => `(http.user_agent eq "${userAgent}")`)
    .join(' or ');

  const payload = {
    id: blockUserAgentsRule.filter.id,
    expression,
    paused: false,
  };

  console.log({ payload });

  const result = await fetchFromApi(
    `/filters/${blockUserAgentsRule.filter.id}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  console.log(result);
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

  api.post(`/cloudflare/blockUserAgent`, async (req, res) => {
    blockedUserAgents = await loadBlockedUserAgents();
    blockedUserAgents.push(req.body.userAgent);
    updateBlockedUserAgents(blockedUserAgents);
    // Optimistic
    res.redirect(req.headers.referer);
  });
  api.post(`/cloudflare/unblockUserAgent`, async (req, res) => {
    blockedUserAgents = await loadBlockedUserAgents();
    blockedUserAgents = blockedUserAgents.filter(
      (el) => el !== req.body.userAgent
    );
    updateBlockedUserAgents(blockedUserAgents);
    // Optimistic
    res.redirect(req.headers.referer);
  });
}

async function load() {
  loadBlockedAddresses();
  loadBlockedUserAgents();

  loadApiRoutes();

  const allRules = await fetchFromApi(`/firewall/rules`);
  console.log({ allRules });

  pipeline.getNode('main').map(augment).registerNode('main');

  aggregator.defaultFormatter.insertFormat('block IP', (entry) => {
    const address = entry.getIn(['address', 'value']);
    if (address) {
      const [url, label] = blockedAddresses.includes(address)
        ? ['/cloudflare/unblockAddress', 'Unblock IP']
        : ['/cloudflare/blockAddress', 'Block IP'];
      return `<form method="POST" action="${url}"><input type="hidden" name="address" value="${address}"/><input type="submit" value="${label}"/></form>`;
    }
  });

  aggregator.defaultFormatter.insertFormat('block UA', (entry) => {
    // console.log(entry.toJS());
    const userAgent = entry.getIn(['signature', 'headers', 'User-Agent']);
    if (userAgent) {
      const [url, label] = blockedUserAgents.includes(userAgent)
        ? ['/cloudflare/unblockUserAgent', 'Unblock UA']
        : ['/cloudflare/blockUserAgent', 'Block UA'];
      return `<form method="POST" action="${url}"><input type="hidden" name="userAgent" value="${userAgent}"/><input type="submit" value="${label}"/></form>`;
    }
  });
}

module.exports = {
  augment,
  load,
};
