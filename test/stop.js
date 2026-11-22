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

  it('ends the log files after the pipeline, and persists even if that fails', async () => {
    const { constants, lib, app } = hyperwatch;
    const history = require('../src/modules/history');
    const original = {
      enabled: constants.persistence.enabled,
      pipelineStop: lib.pipeline.stop,
      stop: lib.persistence.stop,
      flush: history.flush,
      appStop: app.stop,
      error: console.error,
    };
    const calls = [];

    try {
      constants.persistence.enabled = true;
      lib.pipeline.stop = async () => calls.push('pipeline.stop');
      history.flush = async ({ timeout }) => {
        calls.push(`flush ${timeout}`);
        throw new Error('disk gone');
      };
      lib.persistence.stop = async () => calls.push('persistence.stop');
      app.stop = () => calls.push('app.stop');
      console.error = (...args) => calls.push(`error: ${args.join(' ')}`);

      await hyperwatch.stop();

      assert.deepStrictEqual(calls, [
        'pipeline.stop',
        'flush 5000',
        'error: Error ending the log files: disk gone',
        'persistence.stop',
        'app.stop',
      ]);
    } finally {
      constants.persistence.enabled = original.enabled;
      lib.pipeline.stop = original.pipelineStop;
      lib.persistence.stop = original.stop;
      history.flush = original.flush;
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
      // Stop once the restore is under way
      while (!restored) {
        await new Promise((resolve) => setImmediate(resolve));
      }
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

  it('starts and stops a mounted Hyperwatch without its own server', async () => {
    const { constants, lib, app, modules } = hyperwatch;
    const original = {
      enabled: constants.persistence.enabled,
      modulesStart: modules.start,
      persistenceStart: lib.persistence.start,
      persistenceStop: lib.persistence.stop,
      pipelineStart: lib.pipeline.start,
      pipelineStop: lib.pipeline.stop,
      appStart: app.start,
    };
    const calls = [];

    try {
      constants.persistence.enabled = true;
      modules.start = () => {};
      lib.persistence.start = async () => calls.push('persistence.start');
      lib.persistence.stop = async () => calls.push('persistence.stop');
      lib.pipeline.start = () => calls.push('pipeline.start');
      lib.pipeline.stop = async () => calls.push('pipeline.stop');
      app.start = () => calls.push('app.start');
      // start() needs init() to have run once
      const warn = console.warn;
      console.warn = () => {};
      try {
        hyperwatch.init();
      } finally {
        console.warn = warn;
      }

      await hyperwatch.start({ listen: false });
      // The real app.stop(): the server never listened
      await hyperwatch.stop();

      assert.deepStrictEqual(calls, [
        'persistence.start',
        'pipeline.start',
        'pipeline.stop',
        'persistence.stop',
      ]);
    } finally {
      constants.persistence.enabled = original.enabled;
      modules.start = original.modulesStart;
      lib.persistence.start = original.persistenceStart;
      lib.persistence.stop = original.persistenceStop;
      lib.pipeline.start = original.pipelineStart;
      lib.pipeline.stop = original.pipelineStop;
      app.start = original.appStart;
    }
  });
});

describe('hyperwatch.app', () => {
  it('stops even when a client keeps a connection open', async () => {
    const net = require('net');
    const { app } = hyperwatch;
    // A free port, for PORT
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, resolve));
    const listening = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const port = process.env.PORT;
    const log = console.log;
    process.env.PORT = String(listening);
    console.log = () => {};
    try {
      await app.start();
      // A response that never ends, like a live log stream
      app.api.get('/test-never-ends', (req, res) => {
        res.write('started');
      });
      const client = net.connect(listening);
      // Reset by the server at stop
      client.on('error', () => {});
      await new Promise((resolve) => client.on('connect', resolve));
      client.write('GET /test-never-ends HTTP/1.1\r\nHost: localhost\r\n\r\n');
      await new Promise((resolve) => client.once('data', resolve));
      const closed = new Promise((resolve) => client.on('close', resolve));
      await Promise.race([
        app.stop(),
        new Promise((resolve, reject) =>
          setTimeout(() => reject(new Error('stop() hung')), 2000)
        ),
      ]);
      await closed;
    } finally {
      if (port === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = port;
      }
      console.log = log;
    }
  });

  it('closes its WebSocket clients and live streams when mounted, so the host server can close', async () => {
    const http = require('http');
    const express = require('express');
    const WebSocket = require('ws');
    const { app } = hyperwatch;
    const log = console.log;
    console.log = () => {};
    const stream = { map() {} };
    const host = express();
    const server = http.createServer(host);
    const originalSetInterval = global.setInterval;
    try {
      // No heartbeat for this test's stream
      global.setInterval = () => undefined;
      try {
        app.websocket.streamToWebsocket('/test-stop-ws', stream);
      } finally {
        global.setInterval = originalSetInterval;
      }
      app.api.streamToHttp('/test-stop-http', stream, {
        format: () => '',
      });
      app.mount(host, { server, path: '/_hyperwatch' });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address();

      const client = new WebSocket(
        `ws://127.0.0.1:${port}/_hyperwatch/test-stop-ws`
      );
      await new Promise((resolve, reject) => {
        client.on('open', resolve);
        client.on('error', reject);
      });
      const wsClosed = new Promise((resolve) => client.on('close', resolve));

      // Resolves once the stream is open, with its end (wrapped, not adopted)
      const { ended: streamEnded } = await new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/_hyperwatch/test-stop-http`, (res) => {
            res.resume();
            resolve({ ended: new Promise((end) => res.on('end', end)) });
          })
          .on('error', reject);
      });

      await app.stop();
      await Promise.race([
        Promise.all([
          wsClosed,
          streamEnded,
          new Promise((resolve) => {
            server.close(resolve);
            server.closeIdleConnections();
          }),
        ]),
        new Promise((resolve, reject) =>
          setTimeout(() => reject(new Error('the host server hung')), 1000)
        ),
      ]);
    } finally {
      console.log = log;
      server.closeAllConnections();
    }
  });

  it('starts listening, then stops, and stopping again does nothing', async () => {
    const { app } = hyperwatch;
    const port = process.env.PORT;
    const log = console.log;
    process.env.PORT = '0';
    console.log = () => {};
    try {
      await app.start();
      await app.stop();
      await app.stop();
    } finally {
      if (port === undefined) {
        delete process.env.PORT;
      } else {
        process.env.PORT = port;
      }
      console.log = log;
    }
  });
});
