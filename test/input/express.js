const assert = require('assert');
const http = require('http');

const express = require('express');

const expressInput = require('../../src/input/express');

describe('Express input', () => {
  let server;
  let baseUrl;
  const logs = [];

  const ok = (req, res) => res.send('ok');

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
    const collectiveJson = (req, res) => res.send('ok');
    app.get('/v1/:collectiveSlug.json', collectiveJson);
    app.get(/^\/(?<slug>[^/]+)\/members\.(?<format>json|csv)$/i, ok);
    app.get(['/a/:id', /^\/b\/(?<id>\d+)$/], (req, res) => res.send('ok'));
    app.get(
      /^\/own\/(?<id>\d+)$/,
      (req, res, next) => {
        req.hyperwatch.route = '/own/:id';
        req.hyperwatch.handler = 'own';
        next();
      },
      ok
    );
    const none = (req, res) => {
      req.hyperwatch.route = null;
      req.hyperwatch.handler = null;
      res.send('ok');
    };
    app.get('/none', none);
    const router = express.Router();
    const user = (req, res) => res.status(404).send('missing');
    router.get('/users/:id', user);
    const fail = (req, res, next) => next(new Error('fail'));
    router.get('/fail', fail);
    app.use('/api', router);
    const getUser = (req, res) => res.send('get');
    const updateUser = (req, res) => res.send('put');
    const anyUser = (req, res, next) => next();
    app.route('/users/:id').all(anyUser).get(getUser).put(updateUser);
    const notFound = (req, res, next) => next();
    app.get('/items/:id', notFound);
    app.get('/cleared/:id', notFound);
    app.use((req, res) => {
      if (req.path.startsWith('/cleared/')) {
        req.hyperwatch.route = null;
        req.hyperwatch.handler = '';
      }
      res.status(404).send('Not found');
    });
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(500).send('Error'));

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function logOf(path, method = 'GET') {
    const count = logs.length;
    await (await fetch(`${baseUrl}${path}`, { method })).text();
    // `finish` can come after the client has the response
    for (let i = 0; i < 50 && logs.length === count; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.strictEqual(logs.length, count + 1);
    const log = logs[count];
    return { route: log.get('route'), handler: log.get('handler') };
  }

  it('sets the path of a string route, and its named handler', async () => {
    assert.deepStrictEqual(await logOf('/v1/babel.json?x=1'), {
      route: '/v1/:collectiveSlug.json',
      handler: 'collectiveJson',
    });
  });

  it('sets a regular expression as written', async () => {
    assert.deepStrictEqual(await logOf('/babel/members.csv'), {
      route: String(/^\/(?<slug>[^/]+)\/members\.(?<format>json|csv)$/i),
      handler: 'ok',
    });
  });

  it('joins the paths of an array, no handler when anonymous', async () => {
    assert.deepStrictEqual(await logOf('/b/1'), {
      route: '/a/:id,/^\\/b\\/(?<id>\\d+)$/',
      handler: undefined,
    });
  });

  it('puts the router path first, even on a 404 the route sent', async () => {
    assert.deepStrictEqual(await logOf('/api/users/1'), {
      route: '/api/users/:id',
      handler: 'user',
    });
  });

  it('shows the requested text of the router path', async () => {
    // req.baseUrl is what was requested, not the mount pattern
    assert.strictEqual((await logOf('/API/users/1')).route, '/API/users/:id');
  });

  it('sets nothing when no route matched', async () => {
    assert.deepStrictEqual(await logOf('/nothing/here'), {
      route: undefined,
      handler: undefined,
    });
  });

  it("prefers the application's route and handler", async () => {
    assert.deepStrictEqual(await logOf('/own/1'), {
      route: '/own/:id',
      handler: 'own',
    });
    assert.deepStrictEqual(await logOf('/none'), {
      route: undefined,
      handler: undefined,
    });
  });

  it("names the handler of the request's method", async () => {
    assert.strictEqual((await logOf('/users/1')).handler, 'getUser');
    assert.strictEqual((await logOf('/users/1', 'HEAD')).handler, 'getUser');
    assert.strictEqual((await logOf('/users/1', 'PUT')).handler, 'updateUser');
  });

  it('keeps the last route of a request handed on with next()', async () => {
    // Documented: Express doesn't say when a route hands the request on
    assert.deepStrictEqual(await logOf('/items/9'), {
      route: '/items/:id',
      handler: 'notFound',
    });
    assert.deepStrictEqual(await logOf('/api/fail'), {
      route: '/fail',
      handler: 'fail',
    });
  });

  it('lets a 404 handler clear them, with null or an empty string', async () => {
    assert.deepStrictEqual(await logOf('/cleared/9'), {
      route: undefined,
      handler: undefined,
    });
  });
});
