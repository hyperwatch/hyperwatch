module.exports = function (hyperwatch) {
  const { pipeline, input, logger } = hyperwatch;

  /* Init Hyperwatch first (will load modules) */

  hyperwatch.init();

  /* Input configuration */
  /* =================== */

  /* WebSocket input */
  /* ------------- */

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
