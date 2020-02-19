const metrics = require('./lib/metrics').connect();
const searches = require('./lib/searches').connect();

module.exports = { metrics, searches };
