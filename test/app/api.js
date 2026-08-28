const assert = require('assert');
const http = require('http');

const { List } = require('immutable');

const api = require('../../src/app/api');
const status = require('../../src/modules/status');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe('API format routes', () => {
  let server;
  let baseUrl;

  before(async () => {
    api.registerAggregator('format-test', {
      dump: () => [],
      getData: () => List(),
      load() {},
      reset() {},
    });
    status.start();

    server = http.createServer(api);
    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await close(server);
  });

  for (const path of ['/nodes.xml', '/format-test.xml', '/status.csv']) {
    it(`rejects the unsupported format in ${path}`, async () => {
      const response = await fetch(`${baseUrl}${path}`);
      assert.strictEqual(response.status, 404);
    });
  }

  for (const path of [
    '/nodes',
    '/nodes.json',
    '/nodes.csv',
    '/format-test',
    '/format-test.json',
    '/format-test.csv',
    '/status',
    '/status.txt',
    '/status.json',
  ]) {
    it(`accepts the supported format in ${path}`, async () => {
      const response = await fetch(`${baseUrl}${path}`);
      assert.strictEqual(response.status, 200);
    });
  }
});
