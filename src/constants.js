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
    firewall: {
      active: false,
      priority: 650, // depends on: address, cloudflare (client IP)
      path: null, // defaults to ./firewall.json
      // Where the lists are kept: 'file' (path above), or a persistence
      // backend such as 's3'. Defaults to persistence.backend
      backend: null,
      // List definitions ({ id, type, action, cloudflare, entries }), used
      // when nothing is stored yet and to add lists the stored ones lack
      lists: [],
      // Automatic Cloudflare sync, with CLOUDFLARE_API_TOKEN and
      // CLOUDFLARE_ZONE_ID: `up` `delay` seconds after an edit, and `down`
      // then `up` every `interval` seconds (0: never)
      sync: { auto: false, delay: 10, interval: 300 },
      // POST /firewall/lists/:id/add|remove: off by default, turn on only
      // behind authentication (Hyperwatch has none)
      edits: false,
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
