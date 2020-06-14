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
    identity: {
      active: false,
      priority: 503,
    },
    addresses: {
      active: false,
      priority: 600,
    },
  },
};

module.exports = rc('hyperwatch', constants);
