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
    // --- Output: depends on full enrichment ---
    history: {
      active: false,
      priority: 700,
    },
  },
  persistence: {
    enabled: false,
    backend: 'file',
    path: null,
    namespace: null,
    // Seconds between periodic snapshots, off when null
    interval: null,
    // Seconds before a phase gives up: restoring at start, each periodic
    // dump, and the final dump plus closing the storage at stop
    deadlines: { load: 60, dump: 60, stop: 20 },
    // With backend 's3'. Needs @aws-sdk/client-s3, credentials from the
    // AWS SDK (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY…)
    s3: {
      bucket: null,
      // Optional, before <namespace>/<name>.json
      prefix: '',
      // The bucket's region; requests follow the redirect when it differs
      region: null,
      // S3-compatible stores (MinIO, Cloudflare R2…)
      endpoint: null,
      forcePathStyle: false,
    },
  },
};

module.exports = rc('hyperwatch', constants);
