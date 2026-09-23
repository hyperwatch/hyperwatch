/*
 * Subscribe to the raw logs of an app embedding Hyperwatch (see
 * docs/express-embedding.md) with a WebSocket client input, enrich them, and
 * print them.
 *
 *   HYPERWATCH_SECRET=… npm start config/websocket_client_example
 *
 * Environment:
 * - HYPERWATCH_URL: the app's raw log stream
 *   (default: ws://localhost:3000/_hyperwatch/logs/raw, an app running locally)
 * - HYPERWATCH_USERNAME / HYPERWATCH_SECRET: the app's Basic Auth credentials
 *   (the username defaults to hyperwatch)
 * - PORT: where this watcher serves its API (default: 4000)
 */

module.exports = function (hyperwatch) {
  const { pipeline, input, logger } = hyperwatch;

  const {
    HYPERWATCH_URL = 'ws://localhost:3000/_hyperwatch/logs/raw',
    HYPERWATCH_USERNAME = 'hyperwatch',
    HYPERWATCH_SECRET,
  } = process.env;

  hyperwatch.init({
    // Not 3000, so the watcher doesn't clash with an app running locally
    port: 4000,
    modules: {
      cloudflare: { active: true },
      geoip: { active: true },
      agent: { active: true },
      hostname: { active: true },
      identity: { active: true },
    },
  });

  // Fetch the logs
  pipeline.registerInput(
    input.websocket.create({
      type: 'client',
      address: HYPERWATCH_URL,
      username: HYPERWATCH_USERNAME,
      password: HYPERWATCH_SECRET,
      reconnectOnClose: true,
    })
  );

  // Output them, enriched
  pipeline
    .getNode('main')
    .map((log) => console.log(logger.defaultFormatter.format(log, 'console')));
};
