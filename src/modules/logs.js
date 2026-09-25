const { api, websocket } = require('../app');
const html = require('../app/html');
const { defaultFormatter } = require('../lib/logger');
const pipeline = require('../lib/pipeline');

const history = require('./history');

function start() {
  html.registerSection('logs');

  api.get('/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html.logsPage(req, Object.keys(pipeline.nodes)));
  });

  for (const [name, stream] of Object.entries(pipeline.nodes)) {
    websocket.streamToWebsocket(`/logs/${name}`, stream, {
      name: `WebSocket (${name} logs)`,
      monitoringEnabled: true,
    });

    api.streamToHttp(`/logs/${name}`, stream, defaultFormatter, {
      name: `HTTP stream (${name} logs)`,
      monitoringEnabled: true,
      history: (limit, filters) => history.latest(name, limit, filters),
    });
  }
}

module.exports = { start };
