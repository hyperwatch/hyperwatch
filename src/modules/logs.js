const { api, websocket } = require('../app');
const pipeline = require('../lib/pipeline');

const defaultFormatter = (log) => {
  return `${log.getIn(['request', 'time'])} ${
    log.getIn(['hostname', 'value']) ||
    log.getIn(['address', 'value']) ||
    log.getIn(['request', 'address'])
  } "${log.getIn(['request', 'method'])} ${log.getIn([
    'request',
    'url',
  ])} ${log.getIn(['response', 'status'])}" ${log.getIn([
    'request',
    'headers',
    'user-agent',
  ])}`;
};

let formatter = defaultFormatter;
const setFormatter = (fn) => (formatter = fn);

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

module.exports = { load, setFormatter };
