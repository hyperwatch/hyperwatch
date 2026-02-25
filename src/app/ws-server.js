const { WebSocketServer } = require('ws');

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

module.exports = { ws, handleUpgrade };
