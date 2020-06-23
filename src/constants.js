const rc = require('rc');

const constants = {
  port: 3000,
  modules: {
    status: {
      active: true,
      priority: 100,
    },
    logs: {
      active: false,
      priority: 200,
    },
    cloudflare: {
      active: false,
      priority: 500,
    },
    geoip: {
      active: false,
      priority: 500,
    },
    agent: {
      active: false,
      priority: 501,
    },
    language: {
      active: false,
      priority: 503,
    },
    hostname: {
      active: false,
      priority: 502,
    },
    dnsbl: {
      active: false,
      priority: 503,
    },
    address: {
      active: false,
      priority: 600,
    },
    identity: {
      active: false,
      priority: 601,
    },
    sparkline: {
      active: false,
      priority: 800,
    },
  },
};

module.exports = rc('hyperwatch', constants);
