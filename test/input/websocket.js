const assert = require('assert');
const net = require('net');

const websocket = require('../../src/input/websocket');

describe('websocket input', () => {
  it('stops without throwing while still connecting, and does not reconnect', async () => {
    // A TCP server that accepts but never answers the WebSocket handshake,
    // so the client stays in the CONNECTING state
    const server = net.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const statuses = [];
    const input = websocket.create({
      address: `ws://127.0.0.1:${port}`,
      reconnectOnClose: true,
    });

    try {
      input.start({
        status: (err, msg) => statuses.push(msg),
        success: () => {},
        reject: () => {},
      });

      assert.doesNotThrow(() => input.stop());
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.ok(
        !statuses.some((msg) => /Reconnecting/.test(msg)),
        `unexpected reconnect: ${statuses.join(', ')}`
      );
    } finally {
      server.close();
    }
  });
});
