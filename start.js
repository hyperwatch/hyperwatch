const path = require('path');

const { isFunction } = require('lodash');

const hyperwatch = require('./hyperwatch');

// Load configuration

let config;
if (process.argv[2]) {
  config = require(path.resolve(process.cwd(), process.argv[2]));
} else {
  config = require(path.resolve(__dirname, './config/default'));
}
if (isFunction(config)) {
  config(hyperwatch);
}

// Start

hyperwatch.start();

// Handle Shutdown

let shutdownInProgress;

function shutdown() {
  if (!shutdownInProgress) {
    shutdownInProgress = true;
    hyperwatch
      .stop()
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
