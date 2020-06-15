const constants = require('../constants');

function getModule(module) {
  switch (module) {
    case 'address':
      return require('./address');
    case 'agent':
      return require('./agent');
    case 'cloudflare':
      return require('./cloudflare');
    case 'dnsbl':
      return require('./dnsbl');
    case 'geoip':
      return require('./geoip');
    case 'hostname':
      return require('./hostname');
    case 'identity':
      return require('./identity');
    case 'language':
      return require('./language');
    case 'logs':
      return require('./logs');
    case 'sparkline':
      return require('./sparkline');
    case 'status':
      return require('./status');
    default:
      throw new Error(`Unknown module '${module}'`);
  }
}

function activeModules() {
  return Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort((a, b) => a.priority - b.priority)
    .filter((m) => m.active === true);
}

function load() {
  for (const { key } of activeModules()) {
    const module = getModule(key);
    if (module && module.load) {
      module.load();
    }
  }
}

function beforeStart() {
  for (const { key } of activeModules()) {
    const module = getModule(key);
    if (module && module.beforeStart) {
      module.beforeStart();
    }
  }
}

module.exports = {
  load,
  beforeStart,
};
