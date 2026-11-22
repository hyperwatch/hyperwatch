const http = require('http');

const express = require('express');

const constants = require('../constants');

const api = require('./api');
const liveStreams = require('./live-streams');
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
 * Closes what Hyperwatch opened: the WebSocket clients and the live log
 * streams, mounted or standalone, so the server serving them can close; then
 * stops listening when start() made Hyperwatch's own server listen
 * @returns {Promise<void>}
 */
function stop() {
  wsServer.closeClients();
  liveStreams.endAll();
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
