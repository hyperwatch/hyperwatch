const debug = require('debug');

const constants = require('../constants');
const pipeline = require('../lib/pipeline');

const debugModules = debug('hyperwatch:modules');

/**
 * A module, as the modules below export it: what it registers in the pipeline
 * at `init()`, what it starts at `start()`, what it loads asynchronously
 * (`ready()`) and stops (`stop()`), and `augment()`, which adds its data to
 * a log (`fast`: with what it has in cache only). All optional.
 * @typedef {object} Module
 * @property {() => void} [init]
 * @property {() => void} [start]
 * @property {() => Promise<unknown>} [ready]
 * @property {() => unknown} [stop]
 * @property {(log: Log, options?: { fast?: boolean }) => Log | Promise<Log>} [augment]
 */

/**
 * @param {string} module The name of a module
 * @returns {Module | undefined}
 */
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
    case 'signature':
      return require('./signature');
    case 'status':
      return require('./status');
    case 'webbotauth':
      return require('./webbotauth');
    default:
      debugModules(`Unknown module '${module}'`);
      return;
  }
}

function activeModulesWithKeys() {
  // Every module has a priority in the defaults (src/constants.js)
  return Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort(
      (a, b) =>
        /** @type {number} */ (a.priority) - /** @type {number} */ (b.priority)
    )
    .filter((m) => m.active === true)
    .map((m) => ({ key: m.key, module: get(m.key) }))
    .filter((m) => m.module);
}

function activeModules() {
  // Filtered by activeModulesWithKeys()
  return activeModulesWithKeys().map((m) => /** @type {Module} */ (m.module));
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

// Resolves once every active module that loads something asynchronously at
// init (module.ready()) has done so
function ready() {
  return Promise.all(
    activeModules()
      .filter((module) => module.ready)
      .map((module) =>
        /** @type {NonNullable<Module['ready']>} */ (module.ready)()
      )
  );
}

// Stops what active modules run in the background (module.stop())
async function stop() {
  for (const module of activeModules()) {
    if (module.stop) {
      try {
        await module.stop();
      } catch (/** @type {any} */ err) {
        console.error('Error stopping a module:', err.message);
      }
    }
  }
}

/** @typedef {import('../types').Log} Log */

module.exports = {
  get,
  init,
  start,
  ready,
  stop,
  activeModules,
};
