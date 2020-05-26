const http = require('http');

const express = require('express');
const expressWs = require('express-ws');

const constants = require('../constants');

const api = require('./api');
const websocket = require('./websocket');

const app = express();
const httpServer = http.createServer(app);
expressWs(app, httpServer);

app.use(api, websocket);

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
