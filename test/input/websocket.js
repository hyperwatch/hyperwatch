const assert = require('assert');
const net = require('net');

const websocket = require('../../src/input/websocket');

// A TCP server that never completes the WebSocket handshake. With `drop`, it
// closes each connection right away, so the client sees a close.
async function listen({ drop = false } = {}) {
  const server = net.createServer((socket) => {
    if (drop) {
      socket.destroy();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startInput(input, statuses) {
  input.start({
    status: (err, msg) => statuses.push(msg),
    success: () => {},
    reject: () => {},
  });
}

describe('websocket input', () => {
  it('stops without throwing while still connecting, and does not reconnect', async () => {
    const server = await listen();
    const statuses = [];
    const input = websocket.create({
      address: `ws://127.0.0.1:${server.address().port}`,
      reconnectOnClose: true,
    });

    try {
      startInput(input, statuses);
      assert.doesNotThrow(() => input.stop());
      await wait(50);

      assert.ok(
        !statuses.some((msg) => /Reconnecting/.test(msg)),
        `unexpected reconnect: ${statuses.join(', ')}`
      );
    } finally {
      server.close();
    }
  });

  it('ignores the late close of a connection stopped just before a restart', async () => {
    const server = await listen();
    let connections = 0;
    server.on('connection', () => connections++);
    const statuses = [];
    const input = websocket.create({
      address: `ws://127.0.0.1:${server.address().port}`,
      reconnectOnClose: true,
    });

    try {
      startInput(input, statuses);
      await wait(20);
      // Back to back: the first socket's close event fires after the restart
      input.stop();
      startInput(input, statuses);
      await wait(100);

      assert.ok(
        !statuses.some((msg) => /Reconnecting/.test(msg)),
        `the obsolete connection scheduled a reconnect: ${statuses.join(', ')}`
      );
      assert.strictEqual(connections, 2);
    } finally {
      input.stop();
      server.close();
    }
  });

  it('reconnects again after being stopped and started', async () => {
    const server = await listen({ drop: true });
    const statuses = [];
    const input = websocket.create({
      address: `ws://127.0.0.1:${server.address().port}`,
      reconnectOnClose: true,
    });

    try {
      startInput(input, statuses);
      input.stop();
      await wait(50);
      statuses.length = 0;

      startInput(input, statuses);
      await wait(100);

      assert.ok(
        statuses.some((msg) => /Reconnecting/.test(msg)),
        `expected a reconnect: ${statuses.join(', ')}`
      );
    } finally {
      input.stop();
      server.close();
    }
  });
});
