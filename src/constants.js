const rc = require('rc');

const constants = {
  port: 3000,
  app: {},
  modules: {
    logs: {
      active: true,
      priority: 0,
    },
  },
  logs: {
    memory: {
      retention: 1000,
    },
  },
};

module.exports = rc('hyperwatch', constants);
