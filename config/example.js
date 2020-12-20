const exampleConfig = function (hyperwatch) {
  const { pipeline, input, format, logger } = hyperwatch;

  /* Init Hyperwatch (will load modules) */

  hyperwatch.init();

  /* Input configuration */
  /* =================== */

  /* Syslog inputs */
  /* ------------- */

  /* Syslog input in Nginx 'combined' format */

  const syslogNginxCombinedInput = input.syslog.create({
    name: 'Syslog (nginx combined format)',
    port: 1514,
    parse: format.nginx.parser({ format: format.nginx.formats.combined }),
  });

  pipeline.registerInput(syslogNginxCombinedInput);

  /* Syslog input in Nginx 'hyperwatch_combined' format */

  const syslogNginxHyperwatchCombinedInput = input.syslog.create({
    name: 'Syslog (nginx hyperwatch_combined format)',
    port: 1515,
    parse: format.nginx.parser({
      format: format.nginx.formats.hyperwatchCombined,
    }),
  });

  pipeline.registerInput(syslogNginxHyperwatchCombinedInput);

  /* Syslog input in Hyperwatch JSON format */

  const syslogInput = input.syslog.create({
    name: 'Syslog (JSON standard format)',
    port: 1516,
  });

  pipeline.registerInput(syslogInput);

  /* Syslog input in Apache 'combined' format */

  const syslogApacheCombinedInput = input.syslog.create({
    name: 'Syslog (apache combined format)',
    port: 1517,
    parse: format.apache.parser({
      format: format.apache.formats.combined,
    }),
  });

  pipeline.registerInput(syslogApacheCombinedInput);

  /* Syslog input in Apache 'hyperwatch_combined' format */

  const syslogApacheHyperwatchCombinedInput = input.syslog.create({
    name: 'Syslog (apache hyperwatch_combined format)',
    port: 1518,
    parse: format.apache.parser({
      format: format.apache.formats.hyperwatchCombined,
    }),
  });

  pipeline.registerInput(syslogApacheHyperwatchCombinedInput);

  /* HTTP inputs */
  /* ----------- */

  /* HTTP input in Hyperwatch JSON format */

  const httpInput = input.http.create({
    name: 'HTTP server (JSON standard format)',
    path: '/input/log',
  });

  pipeline.registerInput(httpInput);

  /* WebSocket inputs */
  /* ---------------- */

  /* WebSocket server input in Hyperwatch JSON format (listening for logs) */

  const webSocketServerInput = input.websocket.create({
    name: 'WebSocket server (JSON standard format)',
    type: 'server',
    path: '/input/log',
  });

  pipeline.registerInput(webSocketServerInput);

  /* WebSocket client input in Hyperwatch JSON format (subscribing to logs) */

  // const websocketClientInput = input.websocket.create({
  //   name: 'WebSocket client (JSON standard format)',
  //   address: 'ws://HOST:PORT/logs',
  // });

  // pipeline.registerInput(websocketClientInput);

  /* File inputs */
  /* ----------- */

  /* File input in Nginx 'combined' format */

  // const fileNginxCombinedInput = input.file.create({
  //   name: 'File input (nginx combined format)',
  //   path: '/var/log/nginx/access.log',
  //   parse: format.nginx.parser({
  //     format: format.nginx.formats.combined,
  //   }),
  // });

  // pipeline.registerInput(fileNginxCombinedInput);

  /* File input in Nginx 'hyperwatch' format */

  // const fileNginxHyperwatchCombinedInput = input.file.create({
  //   name: 'File input (nginx hyperwatch_combined format)',
  //   path: '/var/log/nginx/hyperwatch.log',
  //   parse: format.nginx.parser({
  //     format: format.nginx.formats.hyperwatchCombined,
  //   }),
  // });

  // pipeline.registerInput(fileNginxHyperwatchCombinedInput);

  /* File input in Apache 'combined' format */

  // const fileApacheCombinedInput = input.file.create({
  //   name: 'File input (nginx combined format)',
  //   path: '/var/log/apache2/access.log',
  //   parse: format.nginx.parser({
  //     format: format.nginx.formats.combined,
  //   }),
  // });

  // pipeline.registerInput(fileApacheCombinedInput);

  /* File input in Apache 'hyperwatch' format */

  // const fileApacheHyperwatchCombinedInput = input.file.create({
  //   name: 'File input (nginx hyperwatch_combined format)',
  //   path: '/var/log/apache2/hyperwatch.log',
  //   parse: format.nginx.parser({
  //     format: format.apache.formats.hyperwatchCombined,
  //   }),
  // });

  // pipeline.registerInput(fileApacheHyperwatchCombinedInput);

  /* Pipeline configuration */
  /* ====================== */

  pipeline
    .getNode('main')
    .map((log) => console.log(logger.defaultFormatter.format(log, 'console')));
};

if (require.main === module) {
  let hyperwatch;

  try {
    hyperwatch = require('../hyperwatch');
  } catch (e) {
    // eslint-disable-next-line node/no-missing-require
    hyperwatch = require('@hyperwatch/hyperwatch');
  }

  exampleConfig(hyperwatch);

  hyperwatch.start();
}

module.exports = exampleConfig;
