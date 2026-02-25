/* eslint-env mocha */

const assert = require('assert');
const http = require('http');

const express = require('express');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');

/**
 * Create a standalone ws-server instance for test isolation.
 * Mirrors the logic in src/app/ws-server.js but with its own state.
 */
function createWsServer() {
  const wss = new WebSocketServer({ noServer: true });
  const routes = new Map();

  function ws(path, handler) {
    routes.set(path, handler);
  }

  function handleUpgrade(request, socket, head) {
    const url = new URL(request.url, 'http://localhost');
    request.query = Object.fromEntries(url.searchParams);

    const handler = routes.get(url.pathname);
    if (handler) {
      wss.handleUpgrade(request, socket, head, (client) => {
        handler(client, request);
      });
    } else {
      socket.destroy();
    }
  }

  return { ws, handleUpgrade };
}

/**
 * Create a test server (Express + HTTP + WebSocket routing).
 */
function createTestServer() {
  const wsServer = createWsServer();
  const app = express();
  const httpServer = http.createServer(app);

  httpServer.on('upgrade', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head);
  });

  return { app, httpServer, wsServer };
}

/**
 * Start the server on a random port and return the base URL.
 */
function listen(httpServer) {
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const { port } = httpServer.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

/**
 * Connect a WebSocket client and wait for it to open.
 */
function connectWs(url) {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url);
    client.on('open', () => resolve(client));
    client.on('error', reject);
  });
}

/**
 * Wait for the next message on a WebSocket client.
 */
function nextMessage(client) {
  return new Promise((resolve) => {
    client.once('message', (data) => resolve(data.toString()));
  });
}

/**
 * Close a server and wait for it to finish.
 */
function close(httpServer) {
  return new Promise((resolve) => httpServer.close(resolve));
}

describe('WebSocket integration', () => {
  let httpServer, wsServer, baseUrl;

  afterEach(async () => {
    if (httpServer) {
      await close(httpServer);
      httpServer = null;
    }
  });

  describe('ws-server routing', () => {
    it('should connect to a registered WebSocket route', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      let handlerCalled = false;
      wsServer.ws('/echo', (client) => {
        handlerCalled = true;
        client.on('message', (msg) => client.send(msg));
      });

      const client = await connectWs(`${baseUrl.replace('http', 'ws')}/echo`);
      assert.strictEqual(handlerCalled, true);

      const msgPromise = nextMessage(client);
      client.send('hello');
      const reply = await msgPromise;
      assert.strictEqual(reply, 'hello');

      client.close();
    });

    it('should reject connections to unregistered paths', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      wsServer.ws('/valid', () => {});

      await assert.rejects(
        () => connectWs(`${baseUrl.replace('http', 'ws')}/invalid`),
        (err) => {
          assert.ok(
            err.message.includes('closed') ||
              err.message.includes('socket hang up') ||
              err.message.includes('ECONNRESET') ||
              err.code === 'ECONNRESET'
          );
          return true;
        }
      );
    });

    it('should parse query parameters onto request.query', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      let receivedQuery;
      wsServer.ws('/params', (client, req) => {
        receivedQuery = req.query;
        client.send('ok');
      });

      const client = await connectWs(
        `${baseUrl.replace('http', 'ws')}/params?foo=bar&num=42`
      );
      assert.deepStrictEqual(receivedQuery, { foo: 'bar', num: '42' });

      client.close();
    });

    it('should route multiple paths independently', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      const connections = { a: 0, b: 0 };
      wsServer.ws('/route-a', (client) => {
        connections.a++;
        client.on('message', (msg) => client.send(`a:${msg}`));
      });
      wsServer.ws('/route-b', (client) => {
        connections.b++;
        client.on('message', (msg) => client.send(`b:${msg}`));
      });

      const clientA = await connectWs(
        `${baseUrl.replace('http', 'ws')}/route-a`
      );
      const msgPromiseA = nextMessage(clientA);
      clientA.send('ping');
      const msgA = await msgPromiseA;
      assert.strictEqual(msgA, 'a:ping');
      assert.strictEqual(connections.a, 1);
      assert.strictEqual(connections.b, 0);

      const clientB = await connectWs(
        `${baseUrl.replace('http', 'ws')}/route-b`
      );
      const msgPromiseB = nextMessage(clientB);
      clientB.send('ping');
      const msgB = await msgPromiseB;
      assert.strictEqual(msgB, 'b:ping');
      assert.strictEqual(connections.a, 1);
      assert.strictEqual(connections.b, 1);

      clientA.close();
      clientB.close();
    });
  });

  describe('streamToWebsocket pattern', () => {
    it('should broadcast stream data to connected WebSocket clients', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      // Simulate the streamToWebsocket pattern from src/app/websocket.js
      const clients = {};
      let mapCallback;

      // Mock stream with .map() that captures the callback
      const mockStream = {
        map(fn) {
          mapCallback = fn;
        },
      };

      wsServer.ws('/logs/test', (client, req) => {
        const clientId = req.query.clientId || 'default';
        clients[clientId] = client;
        client.on('close', () => delete clients[clientId]);
      });

      // Register the broadcast callback (mirrors websocket.streamToWebsocket)
      mockStream.map((log) => {
        Object.values(clients).forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(log));
          }
        });
      });

      // Connect a client
      const client = await connectWs(
        `${baseUrl.replace('http', 'ws')}/logs/test?clientId=test1`
      );

      // Push data through the mock stream
      const msgPromise = nextMessage(client);
      mapCallback({ event: 'request', method: 'GET', url: '/api/test' });
      const received = JSON.parse(await msgPromise);

      assert.strictEqual(received.event, 'request');
      assert.strictEqual(received.method, 'GET');
      assert.strictEqual(received.url, '/api/test');

      client.close();
    });

    it('should handle multiple clients with clientId deduplication', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      const clients = {};

      wsServer.ws('/logs/dedup', (client, req) => {
        const clientId = req.query.clientId || 'default';
        if (clients[clientId]) {
          client.terminate();
          return;
        }
        clients[clientId] = client;
        client.on('close', () => delete clients[clientId]);
      });

      // First connection with clientId=abc should succeed
      const client1 = await connectWs(
        `${baseUrl.replace('http', 'ws')}/logs/dedup?clientId=abc`
      );
      assert.strictEqual(Object.keys(clients).length, 1);

      // Second connection with same clientId should be terminated
      const client2 = new WebSocket(
        `${baseUrl.replace('http', 'ws')}/logs/dedup?clientId=abc`
      );
      await new Promise((resolve) => {
        client2.on('close', resolve);
        client2.on('error', () => {});
      });

      assert.strictEqual(Object.keys(clients).length, 1);

      client1.close();
    });
  });

  describe('WebSocket server input pattern', () => {
    it('should receive messages sent by a WebSocket client', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      // Simulate the input/websocket.js server pattern
      const received = [];
      wsServer.ws('/input', (ws) => {
        ws.on('message', (message) => {
          received.push(JSON.parse(message.toString()));
        });
      });

      const client = await connectWs(`${baseUrl.replace('http', 'ws')}/input`);

      client.send(JSON.stringify({ type: 'log', data: 'test1' }));
      client.send(JSON.stringify({ type: 'log', data: 'test2' }));

      // Give a tick for messages to arrive
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(received.length, 2);
      assert.strictEqual(received[0].data, 'test1');
      assert.strictEqual(received[1].data, 'test2');

      client.close();
    });
  });

  describe('HTTP and WebSocket coexistence', () => {
    it('should serve HTTP and WebSocket on the same port', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      setup.app.get('/health', (req, res) => res.send('ok'));
      baseUrl = await listen(httpServer);

      // Test HTTP using http.get to avoid connection pooling
      const body = await new Promise((resolve, reject) => {
        http
          .get(`${baseUrl}/health`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });
      assert.strictEqual(body, 'ok');

      // Test WebSocket
      let wsConnected = false;
      wsServer.ws('/ws', (client) => {
        wsConnected = true;
        client.on('message', (msg) => client.send(msg));
      });

      const client = await connectWs(`${baseUrl.replace('http', 'ws')}/ws`);
      assert.strictEqual(wsConnected, true);

      const msgPromise = nextMessage(client);
      client.send('test');
      const msg = await msgPromise;
      assert.strictEqual(msg, 'test');

      client.close();
    });
  });
});
