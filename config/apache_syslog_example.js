module.exports = function (hyperwatch) {
  const { pipeline, input, format, logger } = hyperwatch;

  /* Init Hyperwatch first (will load modules) */

  hyperwatch.init();

  /* Input configuration */
  /* =================== */

  /* Syslog input  */
  /* ------------- */

  const syslogApacheHyperwatchCombinedInput = input.syslog.create({
    port: 1518,
    parse: format.apache.parser({
      format: format.apache.formats.hyperwatchCombined,
    }),
  });

  pipeline.registerInput(syslogApacheHyperwatchCombinedInput);

  /* Pipeline configuration */
  /* ====================== */

  pipeline
    .getNode('main')
    .map((log) => console.log(logger.defaultFormatter.format(log, 'console')));
};
