const rc = require('rc');

const constants = {
  port: 3000,
  modules: {
    addresses: {
      active: false,
      priority: 0,
    },
    logs: {
      active: true,
      priority: 0,
    },
  },
};

module.exports = rc('hyperwatch', constants);
