const constants = require('../constants');

const logs = require('./logs');

const modules = { logs };

function load() {
  Object.keys(constants.modules)
    .map((key) => Object.assign({ key }, constants.modules[key]))
    .sort((a, b) => b.priority - a.priority)
    .forEach(({ key }) => {
      // Here we need to access from the object as module with higer
      // priority can deactivate modules with lower
      if (modules[key] && constants.modules[key].active) {
        modules[key].load();
      }
    });
}

module.exports = {
  load,
  ...modules,
};
