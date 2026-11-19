const http = require('http');

const express = require('express');

const constants = require('../constants');

const api = require('./api');
const mount = require('./mount');
const websocket = require('./websocket');
const wsServer = require('./ws-server');

const app = express();
const httpServer = http.createServer(app);

// Open connections, closed at stop: live log streams never end their
// responses, and WebSocket clients stay connected
/** @type {Set<import('net').Socket>} */
const sockets = new Set();
httpServer.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

httpServer.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head);
});

app.use(api);

/**
 * Listens on `PORT` (or `port`) for the API and the WebSocket streams
 * @returns {Promise<void>} once listening
 */
function start() {
  const port = process.env.PORT || constants.port;
  return new Promise((resolve) => {
    httpServer.listen(port, () => {
      console.log(`HTTP and Websocket Server listening on port ${port}`);
      resolve();
    });
  });
}

/**
 * Stops listening and closes the open connections (live streams, WebSocket
 * clients), when start() made the server listen: nothing to do for an app
 * that mounts Hyperwatch in its own server
 * @returns {Promise<void>}
 */
function stop() {
  if (!httpServer.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    httpServer.close(() => resolve());
    for (const socket of sockets) {
      socket.destroy();
    }
  });
}

module.exports = { api, mount, start, stop, websocket };
