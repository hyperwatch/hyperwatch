const path = require('path');

const { merge } = require('lodash');

const app = require('./app');
const constants = require('./constants');
const format = require('./format');
const input = require('./input');
const lib = require('./lib');
const modules = require('./modules');
const plugins = require('./plugins');

const { cache, logger, persistence, pipeline, util } = lib;

let initialized = false;

function getPersistenceDir() {
  const base =
    constants.persistence.path || path.join(process.cwd(), '.hyperwatch-data');
  return constants.persistence.namespace
    ? path.join(base, constants.persistence.namespace)
    : base;
}

function init(config = {}) {
  if (initialized) {
    console.warn(`Can't init, Hyperwatch was already initialized.`);
    return;
  }
  merge(constants, config);
  modules.init();
  initialized = true;
}

function start() {
  if (!initialized) {
    console.warn(`Can't start, Hyperwatch was not initialized.`);
    return;
  }
  modules.start();
  if (constants.persistence.enabled) {
    persistence.load(getPersistenceDir());
  }
  return Promise.all([app.start(), pipeline.start()]);
}

async function stop() {
  await pipeline.stop();
  try {
    if (constants.persistence.enabled) {
      persistence.dump(getPersistenceDir());
    }
  } catch (err) {
    console.error('Error dumping aggregators:', err.message);
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
};
