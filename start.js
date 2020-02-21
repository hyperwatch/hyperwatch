const http = require('http');
const path = require('path');
const express = require('express');
const expressWs = require('express-ws');

// Load configuration

if (process.argv[2]) {
  require(path.resolve(process.cwd(), process.argv[2]));
} else {
  require(path.resolve(__dirname, './config/default'));
}

// Load Core

const hyperWatch = require('./hyper-watch')();

// Load Express

const app = express();
const httpServer = http.createServer(app);
expressWs(app, httpServer);

app.use(hyperWatch.apps.api, hyperWatch.apps.websocket);

Object.keys(hyperWatch.constants.app).forEach(key => {
  app.set(key, hyperWatch.constants.app[key]);
});

const port = process.env.PORT || hyperWatch.constants.port;

httpServer.listen(port, () => {
  console.log(`HTTP and Websocket Server listening on port ${port}`);
});

// Start Pipeline

hyperWatch.pipeline.start();

// Handle Shutdown

let shutdownInProgress;

function shutdown() {
  if (!shutdownInProgress) {
    shutdownInProgress = true;
    Promise.all([
      httpServer.close(),
      hyperWatch.pipeline.stop(),
      hyperWatch.database.close(),
    ])
      .then(() => {
        process.exit();
      })
      .catch(console.error);
  }
}

process.on('SIGTERM', () => {
  console.log('SIGTERM');
  shutdown();
});

process.on('SIGINT', () => {
  console.log('SIGINT');
  shutdown();
});
