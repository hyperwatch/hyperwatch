const merge = require('lodash.merge');

const constants = require('./constants');

module.exports = (config = {}) => {
  merge(constants, config);

  const lib = require('./lib');

  const apps = require('./apps');
  const plugins = require('./plugins');
  const format = require('./format');
  const input = require('./input');

  return Object.assign(
    {
      constants,
      apps,
      plugins,
      format,
      input,
    },
    lib
  );
};
