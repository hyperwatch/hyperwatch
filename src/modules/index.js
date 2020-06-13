const constants = require('../constants');

const addresses = require('./addresses');
const agent = require('./agent');
const geoip = require('./geoip');
const identities = require('./identities');
const logs = require('./logs');
const status = require('./status');

const modules = { addresses, agent, geoip, identities, logs, status };

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
