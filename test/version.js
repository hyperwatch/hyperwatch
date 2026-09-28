const assert = require('assert');
const http = require('http');

const express = require('express');
const WebSocket = require('ws');

const { version } = require('../package.json');
const hyperwatch = require('../src');
const api = require('../src/app/api');
const wsServer = require('../src/app/ws-server');
const websocket = require('../src/input/websocket');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Hyperwatch version', () => {
  let server;
  let port;

  before(async () => {
    wsServer.ws('/version-test', () => {});
    server = http.createServer(api);
    server.on('upgrade', (request, socket, head) =>
      wsServer.handleUpgrade(request, socket, head)
    );
    port = await listen(server);
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('is exported', () => {
    assert.strictEqual(hyperwatch.version, version);
  });

  it('is sent with HTTP responses', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/nodes.json`);
    assert.strictEqual(response.headers.get('x-hyperwatch-version'), version);
  });

  it('is sent with WebSocket handshakes', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/version-test`);
    const headers = await new Promise((resolve, reject) => {
      socket.on('upgrade', (response) => resolve(response.headers));
      socket.on('error', reject);
    });
    socket.terminate();
    assert.strictEqual(headers['x-hyperwatch-version'], version);
  });

  it('is sent with WebSocket handshakes when mounted in an app', async () => {
    const app = express();
    const mounted = http.createServer(app);
    hyperwatch.app.mount(app, {
      server: mounted,
      path: '/_hyperwatch',
      middleware: (req, res, next) =>
        req.headers.authorization === 'Basic secret'
          ? next()
          : res.sendStatus(401),
    });
    const mountedPort = await listen(mounted);
    try {
      const socket = new WebSocket(
        `ws://127.0.0.1:${mountedPort}/_hyperwatch/version-test`,
        { headers: { authorization: 'Basic secret' } }
      );
      const headers = await new Promise((resolve, reject) => {
        socket.on('upgrade', (response) => resolve(response.headers));
        socket.on('error', reject);
      });
      socket.terminate();
      assert.strictEqual(headers['x-hyperwatch-version'], version);
    } finally {
      await new Promise((resolve) => mounted.close(resolve));
    }
  });

  it('shows in the status of websocket inputs', async () => {
    const statuses = [];
    const input = websocket.create({
      address: `ws://127.0.0.1:${port}/version-test`,
    });
    input.start({
      status: (err, msg) => statuses.push(msg),
      success: () => {},
      reject: () => {},
    });
    await wait(100);
    input.stop();

    assert.ok(
      statuses.includes(
        `Listening to ws://127.0.0.1:${port}/version-test (Hyperwatch ${version})`
      ),
      statuses.join(', ')
    );
  });

  it('is left out of the status when the server sends none', async () => {
    const other = new WebSocket.WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((resolve) => other.on('listening', resolve));
    const address = `ws://127.0.0.1:${other.address().port}`;
    const statuses = [];
    const input = websocket.create({ address });
    input.start({
      status: (err, msg) => statuses.push(msg),
      success: () => {},
      reject: () => {},
    });
    await wait(100);
    input.stop();
    other.close();

    assert.ok(
      statuses.includes(`Listening to ${address}`),
      statuses.join(', ')
    );
  });
});
