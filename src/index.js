const { merge } = require('lodash');

const app = require('./app');
const constants = require('./constants');
const format = require('./format');
const input = require('./input');
const lib = require('./lib');
const modules = require('./modules');
const plugins = require('./plugins');

const { pipeline, util } = lib;

let initialized = false;

function init(config = {}) {
  if (initialized) {
    console.warn(`Can't init, Hyperwatch was already initialized`);
    return;
  }
  merge(constants, config);
  modules.load();
  initialized = true;
}

function start() {
  if (!initialized) {
    console.warn(`Can't start, Hyperwatch was not initialized.`);
    return;
  }
  modules.beforeStart();
  return Promise.all([app.start(), pipeline.start()]);
}

function stop() {
  return Promise.all([app.stop(), pipeline.stop()]);
}

module.exports = {
  app,
  constants,
  format,
  input,
  lib,
  modules,
  pipeline,
  plugins,
  init,
  start,
  stop,
  util,
};
