/*
 * Watch the traffic of an app embedding Hyperwatch, as Open Collective does
 * for opencollective.com: the app only streams its raw logs, and this config
 * runs the analysis.
 *
 *   HYPERWATCH_SECRET=… npm start config/opencollective_example
 *
 * Environment:
 * - HYPERWATCH_URL: the app's raw log stream
 *   (default: ws://localhost:3000/_hyperwatch/logs/raw, an app running locally)
 * - HYPERWATCH_USERNAME / HYPERWATCH_SECRET: the app's Basic Auth credentials
 *   (the username defaults to hyperwatch)
 * - PORT: where this watcher serves its API and streams (default: 4000)
 *
 * See docs/embedding.md for the app side.
 */

module.exports = function (hyperwatch) {
  const { pipeline, input, logger } = hyperwatch;

  const {
    HYPERWATCH_URL = 'ws://localhost:3000/_hyperwatch/logs/raw',
    HYPERWATCH_USERNAME = 'hyperwatch',
    HYPERWATCH_SECRET,
  } = process.env;

  // All the analysis happens here, not in the app
  hyperwatch.init({
    // Not 3000, so the watcher doesn't clash with an app running locally
    port: 4000,
    modules: {
      logs: { active: true },
      cloudflare: { active: true },
      geoip: { active: true },
      agent: { active: true },
      hostname: { active: true },
      address: { active: true },
      signature: { active: true },
      identity: { active: true },
    },
    persistence: { enabled: true, namespace: 'opencollective' },
  });

  // Subscribe to the raw logs of the app
  pipeline.registerInput(
    input.websocket.create({
      type: 'client',
      address: HYPERWATCH_URL,
      username: HYPERWATCH_USERNAME,
      password: HYPERWATCH_SECRET,
      reconnectOnClose: true,
    })
  );

  // Skip static assets and Hyperwatch's own routes,
  // and keep sign-in tokens out of the logs
  pipeline
    .getNode('main')
    .filter((log) => {
      const url = log.getIn(['request', 'url']);
      return !url.startsWith('/static/') && !url.startsWith('/_hyperwatch/');
    })
    .map((log) =>
      log.updateIn(['request', 'url'], (url) =>
        url.replace(/^\/signin\/[^/?]+/, '/signin/[token]')
      )
    )
    .registerNode('main');

  // One stream for known clients, one for everyone else
  const [identified, unidentified] = pipeline
    .getNode('main')
    .split((log) => log.has('identity'), ['identified', 'unidentified']);
  identified.registerNode('identified');
  unidentified.registerNode('unidentified');

  // Requests slower than a second
  pipeline
    .getNode('main')
    .filter((log) => log.get('executionTime') > 1000)
    .registerNode('slow');

  // Print the traffic nobody vouches for in the terminal
  pipeline
    .getNode('unidentified')
    .map((log) => console.log(logger.defaultFormatter.format(log, 'console')));
};
