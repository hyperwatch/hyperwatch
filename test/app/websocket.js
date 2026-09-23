const assert = require('assert');
const http = require('http');

const express = require('express');
const WebSocket = require('ws');

const api = require('../../src/app/api');
const websocket = require('../../src/app/websocket');
const wsServer = require('../../src/app/ws-server');
const websocketInput = require('../../src/input/websocket');

/**
 * Create a test server (Express + HTTP + WebSocket routing) wired to the
 * real ws-server module, the same way src/app/index.js does it.
 */
function createTestServer() {
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

      let mapCallback;
      const mockStream = {
        map(fn, name) {
          mapCallback = fn;
          assert.strictEqual(name, 'ws:/logs/test');
        },
      };

      const originalSetInterval = global.setInterval;
      global.setInterval = () => undefined;
      try {
        websocket.streamToWebsocket('/logs/test', mockStream);
      } finally {
        global.setInterval = originalSetInterval;
      }

      const client = await connectWs(
        `${baseUrl.replace('http', 'ws')}/logs/test?clientId=test1`
      );

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

      const originalSetInterval = global.setInterval;
      global.setInterval = () => undefined;
      try {
        websocket.streamToWebsocket('/logs/dedup', { map() {} });
      } finally {
        global.setInterval = originalSetInterval;
      }

      const client1 = await connectWs(
        `${baseUrl.replace('http', 'ws')}/logs/dedup?clientId=abc`
      );

      const client2 = new WebSocket(
        `${baseUrl.replace('http', 'ws')}/logs/dedup?clientId=abc`
      );
      await new Promise((resolve) => {
        client2.on('close', resolve);
        client2.on('error', () => {});
      });

      assert.strictEqual(client1.readyState, WebSocket.OPEN);

      client1.close();
    });
  });

  describe('WebSocket server input pattern', () => {
    it('should receive messages sent by a WebSocket client', async () => {
      const setup = createTestServer();
      httpServer = setup.httpServer;
      wsServer = setup.wsServer;
      baseUrl = await listen(httpServer);

      let resolveReceived;
      const received = new Promise((resolve) => {
        resolveReceived = resolve;
      });
      const input = websocketInput.create({
        type: 'server',
        path: '/input',
      });
      input.start({
        status() {},
        reject: assert.fail,
        success: resolveReceived,
      });

      const client = await connectWs(`${baseUrl.replace('http', 'ws')}/input`);

      client.send(JSON.stringify({ type: 'log', data: 'test' }));
      const message = await received;
      assert.strictEqual(message.get('type'), 'log');
      assert.strictEqual(message.get('data'), 'test');

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
  describe('Embedding in an Express app', () => {
    const credentials = `Basic ${Buffer.from('hyperwatch:secret').toString('base64')}`;
    const headers = { authorization: credentials };

    const auth = (req, res, next) => {
      if (req.headers.authorization === credentials) {
        return next();
      }
      res.status(401).send('Unauthorized');
    };

    /**
     * A host application embedding Hyperwatch under /_hyperwatch, behind
     * authentication, with a catch-all route like a Next.js custom server.
     */
    function createEmbeddedServer(...hyperwatchMiddlewares) {
      const host = express();
      host.use('/_hyperwatch', auth, ...hyperwatchMiddlewares);
      host.use((req, res) => res.status(404).send('Host page not found'));
      const server = http.createServer(host);
      wsServer.attach(server, host);
      return server;
    }

    function streamTo(endpoint) {
      let emit;
      const originalSetInterval = global.setInterval;
      global.setInterval = () => undefined;
      try {
        websocket.streamToWebsocket(endpoint, {
          map(fn) {
            emit = fn;
          },
        });
      } finally {
        global.setInterval = originalSetInterval;
      }
      return (log) => emit(log);
    }

    function connectWithOptions(url, options) {
      return new Promise((resolve, reject) => {
        const client = new WebSocket(url, options);
        client.on('open', () => resolve(client));
        client.on('unexpected-response', (req, res) =>
          reject(new Error(`Unexpected server response: ${res.statusCode}`))
        );
        client.on('error', reject);
      });
    }

    it('can be mounted with app.use (regression: express-ws removal)', () => {
      assert.doesNotThrow(() => express().use('/_hyperwatch', auth, websocket));
    });

    it('streams logs under the mount path of the API', async () => {
      const emit = streamTo('/logs/embedded');
      httpServer = createEmbeddedServer(api);
      baseUrl = await listen(httpServer);

      const client = await connectWithOptions(
        `${baseUrl.replace('http', 'ws')}/_hyperwatch/logs/embedded`,
        { headers }
      );
      const message = nextMessage(client);
      emit({ request: { url: '/' } });
      assert.deepStrictEqual(JSON.parse(await message), {
        request: { url: '/' },
      });
      client.close();
    });

    it('streams logs with the websocket middleware mounted explicitly', async () => {
      const emit = streamTo('/logs/embedded-explicit');
      httpServer = createEmbeddedServer(websocket, api);
      baseUrl = await listen(httpServer);

      const client = await connectWithOptions(
        `${baseUrl.replace('http', 'ws')}/_hyperwatch/logs/embedded-explicit`,
        { headers }
      );
      const message = nextMessage(client);
      emit({ ok: true });
      assert.deepStrictEqual(JSON.parse(await message), { ok: true });
      client.close();
    });

    it('runs the host middlewares, rejecting unauthenticated upgrades', async () => {
      streamTo('/logs/embedded-auth');
      httpServer = createEmbeddedServer(api);
      baseUrl = await listen(httpServer);

      await assert.rejects(
        () =>
          connectWithOptions(
            `${baseUrl.replace('http', 'ws')}/_hyperwatch/logs/embedded-auth`
          ),
        /Unexpected server response: 401/
      );
    });

    it('answers 404 when the route is not under the mount path', async () => {
      streamTo('/logs/embedded-404');
      httpServer = createEmbeddedServer(api);
      baseUrl = await listen(httpServer);

      await assert.rejects(
        () =>
          connectWithOptions(
            `${baseUrl.replace('http', 'ws')}/elsewhere/logs/embedded-404`,
            { headers }
          ),
        /Unexpected server response: 404/
      );
    });

    it('leaves other upgrades to other listeners', async () => {
      httpServer = createEmbeddedServer(api);
      const other = new WebSocket.Server({ noServer: true });
      httpServer.on('upgrade', (req, socket, head) => {
        if (req.url === '/other') {
          other.handleUpgrade(req, socket, head, (client) =>
            client.send('other')
          );
        }
      });
      baseUrl = await listen(httpServer);

      const client = new WebSocket(`${baseUrl.replace('http', 'ws')}/other`);
      assert.strictEqual(await nextMessage(client), 'other');
      client.close();
      other.close();
    });

    it('still serves the HTTP API under the mount path', async () => {
      httpServer = createEmbeddedServer(api);
      baseUrl = await listen(httpServer);

      const status = await new Promise((resolve, reject) => {
        http
          .get(`${baseUrl}/_hyperwatch/nodes.json`, { headers }, (res) => {
            res.resume();
            resolve(res.statusCode);
          })
          .on('error', reject);
      });
      assert.strictEqual(status, 200);
    });
  });
});
