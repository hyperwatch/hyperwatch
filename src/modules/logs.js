const { api, websocket } = require('../app');
const { Formatter } = require('../lib/formatter');
const pipeline = require('../lib/pipeline');

let formatter = new Formatter();
const setFormatter = (obj) => (formatter = obj);

function load() {
  for (const [name, stream] of Object.entries(pipeline.nodes)) {
    websocket.streamToWebsocket(`/logs/${name}`, stream, {
      name: `WebSocket (${name} logs)`,
      monitoringEnabled: true,
    });

    api.streamToHttp(`/logs/${name}`, stream, formatter, {
      name: `HTTP stream (${name} logs)`,
      monitoringEnabled: true,
    });
  }
}

module.exports = { load, formatter, setFormatter };
