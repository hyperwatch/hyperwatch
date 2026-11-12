const { merge } = require('lodash');

const app = require('./app');
const constants = require('./constants');
const format = require('./format');
const input = require('./input');
const lib = require('./lib');
const modules = require('./modules');
const history = require('./modules/history');
const plugins = require('./plugins');
const version = require('./version');

const { cache, logger, persistence, pipeline, util } = lib;

let initialized = false;
let stopping = false;

/**
 * Merges `config` into the configuration and loads the active modules.
 * Call once, before start().
 * @param {import('./types').Config} [config] See docs/configuration.md
 */
function init(config = {}) {
  if (initialized) {
    console.warn(`Can't init, Hyperwatch was already initialized.`);
    return;
  }
  merge(constants, config);
  persistence.normalize(constants.persistence);
  modules.init();
  initialized = true;
}

/**
 * Starts the modules, restores the persistence when enabled, then the inputs
 * and the API.
 */
async function start() {
  if (!initialized) {
    console.warn(`Can't start, Hyperwatch was not initialized.`);
    return;
  }
  stopping = false;
  modules.start();
  // Modules that load data at init (e.g. firewall lists from S3) are ready
  // before the inputs start
  await modules.ready();
  if (stopping) {
    return;
  }
  // Modules have registered their aggregators: restore them before the
  // inputs start
  if (constants.persistence.enabled) {
    await persistence.start(constants.persistence);
    // Stopped while restoring: the inputs and the app must not start
    if (stopping) {
      return;
    }
  }
  return Promise.all([app.start(), pipeline.start()]);
}

async function stop() {
  stopping = true;
  persistence.stopSnapshots();
  // Background work of modules first, e.g. the firewall's Cloudflare syncs
  await modules.stop();
  try {
    await pipeline.stop();
  } catch (/** @type {any} */ err) {
    console.error('Error stopping the pipeline:', err.message);
  }
  // No more logs coming: end the log files (at most 5 s), whatever happens
  // to persistence next
  try {
    await history.flush({ timeout: 5000 });
  } catch (/** @type {any} */ err) {
    console.error('Error ending the log files:', err.message);
  }
  // Persist even if stopping the inputs failed
  if (constants.persistence.enabled) {
    await persistence.stop(constants.persistence);
  }
  return app.stop();
}

module.exports = {
  app,
  cache,
  constants,
  format,
  input,
  lib,
  logger,
  modules,
  pipeline: /** @type {import('./lib/pipeline').Root} */ (pipeline),
  plugins,
  init,
  start,
  stop,
  util,
  version,
};
