const { api, websocket } = require('../app');
const html = require('../app/html');
const { defaultFormatter } = require('../lib/logger');
const pipeline = require('../lib/pipeline');

const history = require('./history');

function start() {
  // The logs section opens on the main node, /logs redirects there
  html.registerSection('logs', 'logs/main');
  api.get('/logs', (req, res) => {
    res.redirect(`${req.baseUrl}/logs/main`);
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
      header: (req) => html.nodesNav(req, name, pipeline.getTree()),
    });
  }
}

module.exports = { start };
