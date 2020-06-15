const path = require('path');

const hyperwatch = require('./hyperwatch');

// Load (will load modules)

hyperwatch.load();

// Load configuration

if (process.argv[2]) {
  require(path.resolve(process.cwd(), process.argv[2]));
} else {
  require(path.resolve(__dirname, './config/default'));
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
