const http = require('http');

const express = require('express');

const constants = require('../constants');
const wsServer = require('./ws-server');

const api = require('./api');
const websocket = require('./websocket');

const app = express();
const httpServer = http.createServer(app);

httpServer.on('upgrade', (request, socket, head) => {
  wsServer.handleUpgrade(request, socket, head);
});

app.use(api);

function start() {
  const port = process.env.PORT || constants.port;
  httpServer.listen(port, () => {
    console.log(`HTTP and Websocket Server listening on port ${port}`);
  });
}

function stop() {
  httpServer.close();
}

module.exports = { api, start, stop, websocket };
