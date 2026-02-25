/* eslint-env mocha */

const assert = require('assert');

const WebSocket = require('ws');

const websocketApp = require('../../src/app/websocket');

describe('WebSocket', () => {
  let server;
  let baseUrl;

  before((done) => {
    server = websocketApp.listen(0, () => {
      baseUrl = `ws://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  after((done) => {
    server.close(done);
  });

  it('should accept WebSocket connections with auto-generated client IDs', (done) => {
    const mockStream = {
      map: () => {},
    };

    websocketApp.streamToWebsocket('/test-ws', mockStream);

    const ws = new WebSocket(`${baseUrl}/test-ws`);
    ws.on('open', () => {
      assert.strictEqual(ws.readyState, WebSocket.OPEN);
      ws.close();
    });
    ws.on('close', () => {
      done();
    });
  });

  it('should accept WebSocket connections with explicit client IDs', (done) => {
    const mockStream = {
      map: () => {},
    };

    websocketApp.streamToWebsocket('/test-ws-explicit', mockStream);

    const ws = new WebSocket(`${baseUrl}/test-ws-explicit?clientId=my-client`);
    ws.on('open', () => {
      assert.strictEqual(ws.readyState, WebSocket.OPEN);
      ws.close();
    });
    ws.on('close', () => {
      done();
    });
  });

  it('should reject duplicate client IDs', (done) => {
    const mockStream = {
      map: () => {},
    };

    websocketApp.streamToWebsocket('/test-ws-dup', mockStream);

    const ws1 = new WebSocket(`${baseUrl}/test-ws-dup?clientId=dup-client`);
    ws1.on('open', () => {
      const ws2 = new WebSocket(`${baseUrl}/test-ws-dup?clientId=dup-client`);
      ws2.on('close', () => {
        // Second connection was terminated due to duplicate ID
        ws1.close();
      });
      ws1.on('close', () => {
        done();
      });
    });
  });
});
