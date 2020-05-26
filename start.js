const path = require('path');

// Load configuration

if (process.argv[2]) {
  require(path.resolve(process.cwd(), process.argv[2]));
} else {
  require(path.resolve(__dirname, './config/default'));
}

// Load Core

const { constants, pipeline, app } = require('./hyperwatch');

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

// Start App

app.start();

// Start Pipeline

pipeline.start();

// Handle Shutdown

let shutdownInProgress;

function shutdown() {
  if (!shutdownInProgress) {
    shutdownInProgress = true;
    Promise.all([app.stop(), pipeline.stop()])
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
