const uuid = require('uuid/v4');

const pipeline = require('../lib/pipeline');

const proxy = require('../plugins/proxy');

let augmented = pipeline

  // Set a UUID if no one is defined
  .map(log => {
    if (!log.has('uuid')) {
      log = log.set('uuid', uuid());
    }
    return log;
  })

  // Detect the public IP address if it's behind a proxy
  .map(log =>
    log.set(
      'address',
      proxy.detectAddress(
        log.getIn(['request', 'address']),
        log.getIn(['request', 'headers'])
      )
    )
  );

module.exports = { stream: augmented };
