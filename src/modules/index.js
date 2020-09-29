const debug = require('debug');

const constants = require('../constants');

const debugModules = debug('hyperwatch:modules');

function get(module) {
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
    case 'signature':
      return require('./signature');
    case 'status':
      return require('./status');
    default:
      debugModules(`Unknown module '${module}'`);
      return;
  }
}

function activeModules() {
  return Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort((a, b) => a.priority - b.priority)
    .filter((m) => m.active === true)
    .map((m) => get(m.key))
    .filter((m) => m);
}

function load() {
  for (const module of activeModules()) {
    if (module && module.load) {
      module.load();
    }
  }
}

function beforeStart() {
  for (const module of activeModules()) {
    if (module && module.beforeStart) {
      module.beforeStart();
    }
  }
}

module.exports = {
  get,
  load,
  beforeStart,
  activeModules,
};
