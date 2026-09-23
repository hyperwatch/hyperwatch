const http = require('http');

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ noServer: true });

const routes = new Map();

// Marks an upgrade request dispatched through an Express app
const upgradeKey = Symbol('hyperwatch.upgrade');

function ws(path, handler) {
  routes.set(path, handler);
}

function handleUpgrade(request, socket, head) {
  const url = new URL(request.url, 'http://localhost');
  request.query = Object.fromEntries(url.searchParams);

  const handler = routes.get(url.pathname);
  if (handler) {
    wss.handleUpgrade(request, socket, head, (client) => {
      handler(client, request);
    });
  } else {
    socket.destroy();
  }
}

/**
 * Express middleware completing the WebSocket upgrades sent by dispatch().
 * The route is matched on the path relative to where the middleware is
 * mounted, so `app.use('/_hyperwatch', middleware)` serves `/_hyperwatch/logs/raw`.
 */
function middleware(req, res, next) {
  const upgrade = req[upgradeKey];
  if (!upgrade) {
    return next();
  }
  const handler = routes.get(req.path);
  if (!handler) {
    // The mount path is Hyperwatch's: unknown routes end here
    return res.status(404).end();
  }
  req[upgradeKey] = null;
  res.detachSocket(upgrade.socket);
  wss.handleUpgrade(req, upgrade.socket, upgrade.head, (client) => {
    handler(client, req);
  });
}

/**
 * Send a WebSocket upgrade through an Express app, like an HTTP request: it
 * goes through the app's middlewares (e.g. authentication) and reaches the
 * WebSocket middleware where it's mounted. The response is bound to the
 * socket, so a middleware can reject the upgrade with an HTTP response, and
 * Express answers errors and unknown routes as usual (e.g. 401, 503, 404).
 */
function dispatch(app, req, socket, head) {
  req[upgradeKey] = { socket, head };
  const res = new http.ServerResponse(req);
  res.assignSocket(socket);
  res.on('finish', () => socket.end());
  app(req, res);
}

module.exports = { ws, handleUpgrade, middleware, dispatch };
