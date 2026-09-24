const assert = require('assert');

const hyperwatch = require('../src');

describe('hyperwatch.stop', () => {
  it('persists and stops the app even if stopping the pipeline fails', async () => {
    const { constants, lib, app } = hyperwatch;
    const original = {
      enabled: constants.persistence.enabled,
      pipelineStop: lib.pipeline.stop,
      dump: lib.persistence.dump,
      appStop: app.stop,
      error: console.error,
    };
    const calls = [];

    try {
      constants.persistence.enabled = true;
      lib.pipeline.stop = () => Promise.reject(new Error('input failed'));
      lib.persistence.dump = () => calls.push('dump');
      app.stop = () => calls.push('app.stop');
      console.error = (...args) => calls.push(`error: ${args.join(' ')}`);

      await hyperwatch.stop();

      assert.deepStrictEqual(calls, [
        'error: Error stopping the pipeline: input failed',
        'dump',
        'app.stop',
      ]);
    } finally {
      constants.persistence.enabled = original.enabled;
      lib.pipeline.stop = original.pipelineStop;
      lib.persistence.dump = original.dump;
      app.stop = original.appStop;
      console.error = original.error;
    }
  });
});
