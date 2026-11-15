// Uses Hyperwatch the way a TypeScript user does. `npm run types:test`
// (scripts/test-types.js) installs the packed package in a temporary project
// and type-checks this file with it, strict.
import http = require('http');

import express = require('express');
import hyperwatch = require('@hyperwatch/hyperwatch');

const { pipeline, input, lib, modules, app } = hyperwatch;

hyperwatch.init({
  modules: { geoip: { active: true }, webbotauth: { active: true } },
  persistence: { enabled: true },
});

const node = pipeline.getNode('main');
const named = node
  .filter((log) => log.getIn(['request', 'method']) === 'GET')
  .map((log) => log.set('checked', true))
  .registerNode('checked');
const [ok, notOk] = named.split((log) => !!log.get('identity'));
ok.registerNode('identified');
notOk.registerNode('unidentified');

// The root is named like any node; a node as second argument still works
pipeline.registerNode('root', { monitor: true });
pipeline.registerNode('checked-again', named);
pipeline.setNode('checked-too', named);

pipeline.registerInput(
  input.websocket.create({
    name: 'Example',
    type: 'client',
    address: 'wss://example.com/logs',
    reconnectOnClose: true,
  })
);

app.api.registerAggregator('example', new lib.aggregator.Aggregator(), {
  nav: true,
  columns: ['count'],
});
app.api.streamToHttp('/example', named, lib.formatter.Formatter.prototype);

const started: Promise<unknown> = hyperwatch.start();
const stopped: Promise<void> = hyperwatch.stop();
// An app typed `Application`, building its own logs
const application: express.Application = express();
const server = http.createServer(application);
app.mount(application, { server, path: '/_hyperwatch' });
const expressInput = input.express.create({ app: application });
application.use(expressInput.middleware());
application.use((req, res, next) => {
  try {
    const log = hyperwatch.util
      .createLog(req, res)
      .set('executionTime', 12)
      .set('graphql', { operationName: 'Example' })
      .deleteIn(['request', 'headers', 'cookie'])
      .setIn(['application', 'user', 'id'], 1);
    expressInput.success(log);
  } catch (err) {
    expressInput.reject(err);
  }
  next();
});
pipeline.registerInput(expressInput);

// getIn() returns any, like get()
node
  .filter((log) => !log.getIn(['request', 'url']).match(/^\/_/))
  .map((log) => log.set('checked', true))
  .filter((log) => log.getIn(['graphql', 'operationName'], 'unknown').length)
  .registerNode('public');

void started;
void stopped;
void modules;

// What the declarations reject
// @ts-expect-error port is a number
hyperwatch.init({ port: 'not a port' });
// @ts-expect-error getNode() takes a node name
pipeline.getNode(42);
// @ts-expect-error registerNode() takes options or a node
pipeline.registerNode('root', 'main');
// @ts-expect-error setNode() takes a node, not options
pipeline.setNode('root', { monitor: true });
// @ts-expect-error a WebSocket input's type is 'client' or 'server'
input.websocket.create({ type: 'peer' });
// @ts-expect-error mount() needs the HTTP server and a path
app.mount(express());
