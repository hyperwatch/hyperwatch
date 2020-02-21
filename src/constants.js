const rc = require('rc');
const path = require('path');

const constants = {
  port: 3000,
  app: {},
  pipeline: {
    allowedLateness: 60,
    watermarkDelay: 5,
  },
  data: {
    protocol: 'file',
    directory: path.resolve(__dirname, '../data'),
    saveInterval: 60 * 60 * 1000,
  },
  metrics: {
    gc: {
      expiration: 24 * 3600,
      interval: 60 * 1000,
    },
  },
  ui: {
    time: {
      sliderValues: ['auto', 30, 60, 60 * 6, 60 * 24],
    },
  },
  modules: {
    logs: {
      active: true,
      priority: 0,
    },
  },
  logs: {
    memory: {
      retention: 1000,
    },
  },
};

module.exports = rc('hyper-watch', constants);
