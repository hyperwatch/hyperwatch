const constants = require('../constants');

const address = require('./address');
const agent = require('./agent');
const cloudflare = require('./cloudflare');
const dnsbl = require('./dnsbl');
const geoip = require('./geoip');
const hostname = require('./hostname');
const identity = require('./identity');
const logs = require('./logs');
const status = require('./status');
const sparkline = require('./sparkline');

const modules = {
  address,
  agent,
  cloudflare,
  dnsbl,
  geoip,
  hostname,
  identity,
  logs,
  status,
  sparkline,
};

function activeModules() {
  return Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort((a, b) => a.priority - b.priority)
    .filter((m) => m.active === true);
}

function register() {
  activeModules().forEach(({ key }) => {
    if (modules[key] && modules[key].register) {
      modules[key].register();
    }
  });
}

function load() {
  activeModules().forEach(({ key }) => {
    if (modules[key] && modules[key].load) {
      modules[key].load();
    }
  });
}

module.exports = {
  register,
  load,
  ...modules,
};
