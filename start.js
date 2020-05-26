const path = require('path');

const hyperwatch = require('./hyperwatch');

// Load configuration

if (process.argv[2]) {
  require(path.resolve(process.cwd(), process.argv[2]));
} else {
  require(path.resolve(__dirname, './config/default'));
}

// Load Modules

const config = hyperwatch.constants;

Object.keys(config.modules)
  .map((key) => Object.assign({ key }, config.modules[key]))
  .sort((a, b) => b.priority - a.priority)
  .forEach(({ key }) => {
    // Here we need to access from the object as module with higer
    // priority can deactivate modules with lower
    if (config.modules[key].active) {
      require(`./src/modules/${key}`);
    }
  });

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
