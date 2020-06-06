const constants = require('../constants');

const addresses = require('./addresses');
const identities = require('./identities');
const logs = require('./logs');
const status = require('./status');

const modules = { addresses, identities, logs, status };

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
