const { merge } = require('lodash');

const app = require('./app');
const constants = require('./constants');
const format = require('./format');
const input = require('./input');
const lib = require('./lib');
const modules = require('./modules');
const plugins = require('./plugins');
const version = require('./version');

const { cache, logger, persistence, pipeline, util } = lib;

let initialized = false;

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

async function start() {
  if (!initialized) {
    console.warn(`Can't start, Hyperwatch was not initialized.`);
    return;
  }
  modules.start();
  // Modules have registered their aggregators: restore them before the
  // inputs start
  if (constants.persistence.enabled) {
    await persistence.start(constants.persistence);
  }
  return Promise.all([app.start(), pipeline.start()]);
}

async function stop() {
  persistence.stopSnapshots();
  try {
    await pipeline.stop();
  } catch (err) {
    console.error('Error stopping the pipeline:', err.message);
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
  pipeline,
  plugins,
  init,
  start,
  stop,
  util,
  version,
};
