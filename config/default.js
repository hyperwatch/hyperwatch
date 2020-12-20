const defaultConfig = function (hyperwatch) {
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

  /* HTTP inputs */
  /* ----------- */

  /* HTTP input in Hyperwatch JSON format */

  const httpInput = input.http.create({
    name: 'HTTP server (JSON standard format)',
    path: '/input/log',
  });

  pipeline.registerInput(httpInput);

  const webSocketServerInput = input.websocket.create({
    name: 'WebSocket server (JSON standard format)',
    type: 'server',
    path: '/input/log',
  });

  pipeline.registerInput(webSocketServerInput);

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

  defaultConfig(hyperwatch);

  hyperwatch.start();
}

module.exports = defaultConfig;
