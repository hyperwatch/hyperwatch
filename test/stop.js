const assert = require('assert');

const hyperwatch = require('../src');

describe('hyperwatch.stop', () => {
  it('persists and stops the app even if stopping the pipeline fails', async () => {
    const { constants, lib, app } = hyperwatch;
    const original = {
      enabled: constants.persistence.enabled,
      pipelineStop: lib.pipeline.stop,
      stopSnapshots: lib.persistence.stopSnapshots,
      stop: lib.persistence.stop,
      appStop: app.stop,
      error: console.error,
    };
    const calls = [];

    try {
      constants.persistence.enabled = true;
      lib.persistence.stopSnapshots = () => calls.push('stopSnapshots');
      lib.pipeline.stop = () => Promise.reject(new Error('input failed'));
      lib.persistence.stop = async () => calls.push('persistence.stop');
      app.stop = () => calls.push('app.stop');
      console.error = (...args) => calls.push(`error: ${args.join(' ')}`);

      await hyperwatch.stop();

      assert.deepStrictEqual(calls, [
        'stopSnapshots',
        'error: Error stopping the pipeline: input failed',
        'persistence.stop',
        'app.stop',
      ]);
    } finally {
      constants.persistence.enabled = original.enabled;
      lib.pipeline.stop = original.pipelineStop;
      lib.persistence.stopSnapshots = original.stopSnapshots;
      lib.persistence.stop = original.stop;
      app.stop = original.appStop;
      console.error = original.error;
    }
  });

  it("doesn't start the inputs and the app when stopped while restoring", async () => {
    const { constants, lib, app, modules } = hyperwatch;
    const original = {
      enabled: constants.persistence.enabled,
      modulesStart: modules.start,
      persistenceStart: lib.persistence.start,
      persistenceStop: lib.persistence.stop,
      pipelineStart: lib.pipeline.start,
      pipelineStop: lib.pipeline.stop,
      appStart: app.start,
      appStop: app.stop,
    };
    const calls = [];
    let restored;

    try {
      constants.persistence.enabled = true;
      modules.start = () => {};
      lib.persistence.start = () =>
        new Promise((resolve) => {
          restored = resolve;
        });
      lib.persistence.stop = async () => calls.push('persistence.stop');
      lib.pipeline.start = () => calls.push('pipeline.start');
      lib.pipeline.stop = async () => calls.push('pipeline.stop');
      app.start = () => calls.push('app.start');
      app.stop = () => calls.push('app.stop');
      // start() needs init() to have run once
      const warn = console.warn;
      console.warn = () => {};
      try {
        hyperwatch.init();
      } finally {
        console.warn = warn;
      }

      const started = hyperwatch.start();
      await hyperwatch.stop();
      restored();
      await started;

      assert.deepStrictEqual(calls, [
        'pipeline.stop',
        'persistence.stop',
        'app.stop',
      ]);
    } finally {
      constants.persistence.enabled = original.enabled;
      modules.start = original.modulesStart;
      lib.persistence.start = original.persistenceStart;
      lib.persistence.stop = original.persistenceStop;
      lib.pipeline.start = original.pipelineStart;
      lib.pipeline.stop = original.pipelineStop;
      app.start = original.appStart;
      app.stop = original.appStop;
    }
  });
});
