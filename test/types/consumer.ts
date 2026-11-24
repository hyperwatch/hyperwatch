// Uses Hyperwatch the way a TypeScript user does. `npm run types:test`
// (scripts/test-types.js) installs the packed package in a temporary project
// and type-checks this file with it, strict.
import http = require('http');
import http2 = require('http2');

import express = require('express');
import hyperwatch = require('@hyperwatch/hyperwatch');
import type { Input, InputHandlers, Log } from '@hyperwatch/hyperwatch';

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
app.api.registerAggregator('example-v1', new lib.aggregator.Aggregator(), {
  nav: { group: 'example', label: 'v1', after: 'logs' },
});
app.api.streamToHttp('/example', named, lib.formatter.Formatter.prototype);

// A custom input, with the types the package exports
let handlers: InputHandlers | undefined;
const custom: Input = {
  name: 'Custom',
  start(h) {
    handlers = h;
  },
};
pipeline.registerInput(custom);

// A log from plain Node req/res (Connect or Vite middleware), not Express
http.createServer((req, res) => {
  const log: Log = hyperwatch.util.createLog(req, res).set('executionTime', 12);
  handlers?.success(log);
  res.end();
});

// Mounted on Express's server, or an HTTP/2 server with HTTP/1 fallback
app.mount(express(), { server: http.createServer(), path: '/hyperwatch' });
app.mount(express(), {
  server: http2.createSecureServer({ allowHTTP1: true }),
  path: '/hyperwatch',
});

const started: Promise<unknown> = hyperwatch.start();
// Mounted in the app's own server: no standalone server
const mounted: Promise<unknown> = hyperwatch.start({ listen: false });
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
    // Set once the pipeline started the input: optional for strict callers
    expressInput.success?.(log);
  } catch (err) {
    expressInput.reject?.(err);
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
void mounted;
void stopped;
void modules;

// A cache provider needs has, get and set only
const entries = new Map<string, unknown>();
hyperwatch.cache.setProvider({
  has: async (key) => entries.has(key),
  get: async (key) => entries.get(key),
  set: async (key, value) => entries.set(key, value),
});

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
// @ts-expect-error a cache provider needs get
hyperwatch.cache.setProvider({
  has: async () => false,
  set: async () => undefined,
});
