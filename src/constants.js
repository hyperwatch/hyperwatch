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
};

module.exports = rc('hyperwatch', constants);
