const merge = require('lodash.merge');

const constants = require('./constants');

module.exports = (config = {}) => {
  merge(constants, config);

  const lib = require('./lib');

  const app = require('./app');
  const plugins = require('./plugins');
  const format = require('./format');
  const input = require('./input');

  return Object.assign(
    {
      constants,
      app,
      plugins,
      format,
      input,
    },
    lib
  );
};
