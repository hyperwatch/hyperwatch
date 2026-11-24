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
        req.hyperwatch.route = { path: '/own/:id', name: 'own.show' };
        next();
      },
      ok
    );
    app.get('/named/:id', (req, res) => {
      req.hyperwatch.route = { name: 'named.show' };
      res.send('ok');
    });
    app.get('/none', (req, res) => {
      req.hyperwatch.route = null;
      res.send('ok');
    });
    const router = express.Router();
    const user = (req, res) => res.status(404).send('missing');
    router.get('/users/:id', user);
    const fail = (req, res, next) => next(new Error('fail'));
    router.get('/fail', fail);
    app.use('/api', router);
    const notFound = (req, res, next) => next();
    app.get('/items/:id', notFound);
    app.get('/cleared/:id', notFound);
    app.use((req, res) => {
      if (req.path.startsWith('/cleared/')) {
        req.hyperwatch.route = null;
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
    const route = log.get('route');
    return route && route.toJS();
  }

  it('sets the path of a string route, and no name', async () => {
    assert.deepStrictEqual(await logOf('/v1/babel.json?x=1'), {
      path: '/v1/:collectiveSlug.json',
    });
  });

  it('sets a regular expression as written', async () => {
    assert.deepStrictEqual(await logOf('/babel/members.csv'), {
      path: String(/^\/(?<slug>[^/]+)\/members\.(?<format>json|csv)$/i),
    });
  });

  it('joins the paths of an array', async () => {
    assert.deepStrictEqual(await logOf('/b/1'), {
      path: '/a/:id,/^\\/b\\/(?<id>\\d+)$/',
    });
  });

  it('puts the router path first, even on a 404 the route sent', async () => {
    assert.deepStrictEqual(await logOf('/api/users/1'), {
      path: '/api/users/:id',
    });
  });

  it('shows the requested text of the router path', async () => {
    // req.baseUrl is what was requested, not the mount pattern
    assert.deepStrictEqual(await logOf('/API/users/1'), {
      path: '/API/users/:id',
    });
  });

  it('sets no route when no route matched', async () => {
    assert.strictEqual(await logOf('/nothing/here'), undefined);
  });

  it("prefers the application's fields", async () => {
    assert.deepStrictEqual(await logOf('/own/1'), {
      path: '/own/:id',
      name: 'own.show',
    });
    assert.deepStrictEqual(await logOf('/named/1'), {
      path: '/named/:id',
      name: 'named.show',
    });
    assert.strictEqual(await logOf('/none'), undefined);
  });

  it('keeps the last route of a request handed on with next()', async () => {
    // Documented: Express doesn't say when a route hands the request on
    assert.deepStrictEqual(await logOf('/items/9'), { path: '/items/:id' });
    assert.deepStrictEqual(await logOf('/api/fail'), { path: '/fail' });
  });

  it('lets a 404 handler clear it with null', async () => {
    assert.strictEqual(await logOf('/cleared/9'), undefined);
  });
});
