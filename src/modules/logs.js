const app = require('../app');
const pipeline = require('../lib/pipeline');

function load() {
  for (const [name, stream] of Object.entries(pipeline.nodes)) {
    app.websocket.streamToWebsocket(`/logs/${name}`, stream, {
      name: `WebSocket (${name} logs)`,
      monitoringEnabled: true,
    });

    app.api.streamToHttp(`/logs/${name}`, stream, {
      name: `HTTP stream (${name} logs)`,
      monitoringEnabled: true,
    });
  }
}

module.exports = { load };
