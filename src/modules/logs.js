const app = require('../app/websocket');
const pipeline = require('../lib/pipeline');

// Expose raw logs

app.streamToWebsocket('/logs/raw', pipeline, {
  name: 'WebSocket (raw logs)',
  monitoringEnabled: true,
});
