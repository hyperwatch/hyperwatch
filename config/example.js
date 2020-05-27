const hyperWatch = require('../hyperwatch');

const { pipeline, input, format, plugins } = hyperWatch;

/* Input configuration
====================== */

/* Syslog inputs
---------------- */

/* Syslog input in Nginx 'combined' format */

const syslogNginxCombinedInput = input.syslog.create({
  name: 'Syslog (nginx combined format)',
  port: 1514,
  parse: format.nginx.parser({ format: format.nginx.formats.combined }),
});

pipeline.registerInput(syslogNginxCombinedInput);

/* Syslog input in Nginx 'access_watch' format */

const syslogNginxAccessWatchInput = input.syslog.create({
  name: 'Syslog (nginx access_watch format)',
  port: 1515,
  parse: format.nginx.parser({ format: format.nginx.formats.accessWatch }),
});

pipeline.registerInput(syslogNginxAccessWatchInput);

/* Syslog input in Hyperwatch JSON format */

const syslogInput = input.syslog.create({
  name: 'Syslog (JSON standard format)',
  port: 1516,
});

pipeline.registerInput(syslogInput);

/* Syslog input in Apache 'combined' format */

// const syslogApacheCombinedInput = input.syslog.create({
//   port: 1517,
//   parse: format.apache.parser({
//     format: format.apache.formats.combined
//   })
// })

// pipeline.registerInput(syslogApacheCombinedInput)

/* Syslog input in Apache 'access_watch_combined' format */

// const syslogApacheAccessWatchCombinedInput = input.syslog.create({
//   port: 1518,
//   parse: format.apache.parser({
//     format: format.apache.formats.accessWatchCombined
//   })
// })

// pipeline.registerInput(syslogApacheAccessWatchCombinedInput)

/* HTTP inputs
-------------- */

/* HTTP input in Hyperwatch JSON format */

const httpInput = input.http.create({
  name: 'HTTP server (JSON standard format)',
  path: '/input/log',
});

pipeline.registerInput(httpInput);

/* WebSocket inputs
------------------- */

/* WebSocket server input in Hyperwatch JSON format (listening for logs) */

// const webSocketServerInput = input.websocket.create({
//   name: 'WebSocket server (JSON standard format)',
//   type: 'server',
//   path: '/input/log'
// })

// pipeline.registerInput(webSocketServerInput)

/* WebSocket client input in Hyperwatch JSON format (subscribing to logs) */

// const websocketClientInput = input.websocket.create({
//   address: 'ws://HOST:PORT/logs'
// })

// pipeline.registerInput(websocketClientInput)

/* File inputs
-------------- */

/* File input in Nginx 'combined' format */

// const fileNginxCombinedInput = input.file.create({
//   path: '/var/log/nginx/access.log',
//   parse: format.nginx.parser({
//     format: format.nginx.formats.combined
//   })
// })

// pipeline.registerInput(fileNginxCombinedInput)

/* File input in Nginx 'access_watch' format */

// const fileNginxAccessWatchInput = input.file.create({
//   path: '/var/log/nginx/access_watch.log',
//   parse: format.nginx.parser({
//     format: format.nginx.formats.accessWatch
//   })
// })

// pipeline.registerInput(fileNginxAccessWatchInput)

/*
Pipeline configuration
======================
*/

const { proxy } = plugins;

const stream = pipeline

  /* Filter requests */

  // .filter(log => log.getIn(['request', 'host']) === 'example.com')

  /* Detect the public IP address if it's behind a proxy */

  .map((log) =>
    log.set(
      'address',
      proxy.detectAddress(
        log.getIn(['request', 'address']),
        log.getIn(['request', 'headers'])
      )
    )
  )

  /* Output to the console as JS object */

  .map((log) => console.log(log.toJS()));

module.exports = {
  stream,
};
