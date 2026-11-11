// Type-checks the published declarations (types/) the way a consumer uses
// Hyperwatch: `npm run types && npm run types:test`
import express = require('express');
import hyperwatch = require('../../types/hyperwatch');

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
void started;
void stopped;
void modules;

// What the declarations reject
// @ts-expect-error port is a number
hyperwatch.init({ port: 'not a port' });
// @ts-expect-error getNode() takes a node name
pipeline.getNode(42);
// @ts-expect-error a WebSocket input's type is 'client' or 'server'
input.websocket.create({ type: 'peer' });
// @ts-expect-error mount() needs the HTTP server and a path
app.mount(express());
