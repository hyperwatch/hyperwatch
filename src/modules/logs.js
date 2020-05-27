const app = require('../app/websocket');
const pipeline = require('../lib/pipeline');

function load() {
  // Expose raw logs
  app.streamToWebsocket('/logs/raw', pipeline, {
    name: 'WebSocket (raw logs)',
    monitoringEnabled: true,
  });
}

module.exports = { load };
