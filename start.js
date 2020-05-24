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

const { constants, pipeline, apps } = require('./hyperwatch')();

// Load Modules

Object.keys(constants.modules)
  .map((key) => Object.assign({ key }, constants.modules[key]))
  .sort((a, b) => b.priority - a.priority)
  .forEach(({ key }) => {
    // Here we need to access from the object as module with higer
    // priority can deactivate modules with lower
    if (constants.modules[key].active) {
      require(`./src/modules/${key}`);
    }
  });

// Load Express

const app = express();
const httpServer = http.createServer(app);
expressWs(app, httpServer);

app.use(apps.api, apps.websocket);

Object.keys(constants.app).forEach((key) => {
  app.set(key, constants.app[key]);
});

const port = process.env.PORT || constants.port;

httpServer.listen(port, () => {
  console.log(`HTTP and Websocket Server listening on port ${port}`);
});

// Start Pipeline

pipeline.start();

// Handle Shutdown

let shutdownInProgress;

function shutdown() {
  if (!shutdownInProgress) {
    shutdownInProgress = true;
    Promise.all([httpServer.close(), pipeline.stop()])
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
