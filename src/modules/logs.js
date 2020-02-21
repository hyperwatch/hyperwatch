const app = require('../apps/websocket');
const pipeline = require('../lib/pipeline');
const { logIsAugmented } = require('../lib/util');

// Expose raw logs

app.streamToWebsocket('/logs/raw', pipeline, {
  name: 'WebSocket (raw logs)',
  monitoringEnabled: true,
});

const { stream: augmentedStream } = require('../pipeline/augmented');

// Expose augmented logs

app.streamToWebsocket('/logs/augmented', augmentedStream, {
  name: 'WebSocket (augmented logs)',
  monitoringEnabled: true,
});

// Expose augmented logs for dashboard

app.streamToWebsocket('/logs', augmentedStream.filter(logIsAugmented));
