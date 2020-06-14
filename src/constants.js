const rc = require('rc');

const constants = {
  port: 3000,
  modules: {
    status: {
      active: true,
      priority: 100,
    },
    logs: {
      active: true,
      priority: 200,
    },
    geoip: {
      active: false,
      priority: 500,
    },
    agent: {
      active: false,
      priority: 501,
    },
    hostname: {
      active: false,
      priority: 502,
    },
    address: {
      active: false,
      priority: 600,
    },
    identity: {
      active: false,
      priority: 601,
    },
  },
};

module.exports = rc('hyperwatch', constants);
