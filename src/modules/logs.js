const { api, websocket } = require('../app');
const { defaultFormatter } = require('../lib/logger');
const pipeline = require('../lib/pipeline');

function start() {
  for (const [name, stream] of Object.entries(pipeline.nodes)) {
    websocket.streamToWebsocket(`/logs/${name}`, stream, {
      name: `WebSocket (${name} logs)`,
      monitoringEnabled: true,
    });

    api.streamToHttp(`/logs/${name}`, stream, defaultFormatter, {
      name: `HTTP stream (${name} logs)`,
      monitoringEnabled: true,
    });
  }
}

module.exports = { start };
