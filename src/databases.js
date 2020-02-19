const rules = require('./lib/rules').connect();
const metrics = require('./lib/metrics').connect();
const searches = require('./lib/searches').connect();

module.exports = { rules, metrics, searches };
