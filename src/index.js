const app = require('./app');
const constants = require('./constants');
const format = require('./format');
const input = require('./input');
const lib = require('./lib');
const plugins = require('./plugins');

const { pipeline, util } = lib;

function start() {
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
  pipeline,
  plugins,
  start,
  stop,
  util,
};
