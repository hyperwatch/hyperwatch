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
    // --- Enrichment: independent modules (no dependencies) ---
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
    hostname: {
      active: false,
      priority: 502,
    },
    language: {
      active: false,
      priority: 503,
    },
    dnsbl: {
      active: false,
      priority: 503,
    },
    // --- Classification: depends on enrichment above ---
    address: {
      active: false,
      priority: 600,
    },
    signature: {
      active: false,
      priority: 610,
    },
    identity: {
      active: false,
      priority: 620, // depends on: agent, hostname, signature, address
    },
    fingerprint: {
      active: false,
      priority: 625, // depends on: agent, identity
    },
    firewall: {
      active: false,
      priority: 650, // requires: all enrichment; injects into address aggregator
    },
    // --- Output: depends on full enrichment ---
    history: {
      active: false,
      priority: 700,
    },
    sparkline: {
      active: false,
      priority: 800,
    },
  },
  persistence: {
    enabled: false,
    path: null,
    namespace: null,
  },
};

module.exports = rc('hyperwatch', constants);
