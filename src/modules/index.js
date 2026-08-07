const debug = require('debug');

const constants = require('../constants');
const pipeline = require('../lib/pipeline');

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
    case 'fingerprint':
      return require('./fingerprint');
    case 'firewall':
      return require('./firewall');
    case 'geoip':
      return require('./geoip');
    case 'history':
      return require('./history');
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

function activeModulesWithKeys() {
  return Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort((a, b) => a.priority - b.priority)
    .filter((m) => m.active === true)
    .map((m) => ({ key: m.key, module: get(m.key) }))
    .filter((m) => m.module);
}

function activeModules() {
  return activeModulesWithKeys().map((m) => m.module);
}

function init() {
  for (const { key, module } of activeModulesWithKeys()) {
    if (module && module.init) {
      pipeline.currentModule = key;
      module.init();
      pipeline.currentModule = null;
    }
  }
}

function start() {
  for (const { key, module } of activeModulesWithKeys()) {
    if (module && module.start) {
      pipeline.currentModule = key;
      module.start();
      pipeline.currentModule = null;
    }
  }
}

module.exports = {
  get,
  init,
  start,
  activeModules,
};
