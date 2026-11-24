const assert = require('assert');
const http = require('http');

const express = require('express');

const expressInput = require('../../src/input/express');

describe('Express input', () => {
  let server;
  let baseUrl;
  const logs = [];

  before(async () => {
    const input = expressInput.create();
    input.start({
      success: (log) => logs.push(log),
      reject: (err) => {
        throw err;
      },
      status: () => {},
    });

    const app = express();
    app.use(input.middleware());
    app.get('/v1/:collectiveSlug.json', (req, res) => res.send('ok'));
    app.get(
      /^\/(?<collectiveSlug>[^/]+)\/members\/(?<type>all|users|organizations)$/,
      (req, res) => res.send('ok')
    );
    app.get('/own/:id', (req, res) => {
      req.hyperwatch.route = '/Own/:Id/';
      res.send('ok');
    });
    app.get('/none', (req, res) => {
      req.hyperwatch.route = null;
      res.send('ok');
    });
    const router = express.Router();
    router.get('/users/:id', (req, res) => res.status(404).send('missing'));
    app.use('/API', router);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function routeOf(path) {
    const count = logs.length;
    await (await fetch(`${baseUrl}${path}`)).text();
    // `finish` can come after the client has the response
    for (let i = 0; i < 50 && logs.length === count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(logs.length, count + 1);
    return logs[count].get('route');
  }

  it('sets the route of a string pattern', async () => {
    assert.strictEqual(
      await routeOf('/v1/babel.json?x=1'),
      '/v1/:collectiveSlug.json'
    );
  });

  it('sets the route of an expression', async () => {
    assert.strictEqual(
      await routeOf('/babel/members/users'),
      '/:collectiveSlug/members/users'
    );
  });

  it('prefixes the router mount path, even on a 404 the route sent', async () => {
    assert.strictEqual(await routeOf('/api/users/1'), '/api/users/:id');
  });

  it('sets no route when none matched', async () => {
    assert.strictEqual(await routeOf('/nothing/here'), undefined);
  });

  it("prefers the application's route", async () => {
    assert.strictEqual(await routeOf('/own/1'), '/own/:Id');
    assert.strictEqual(await routeOf('/none'), undefined);
  });
});
