const http = require('http');

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ noServer: true });

const routes = new Map();

// Marks an upgrade request dispatched through an Express app
const upgradeKey = Symbol('hyperwatch.upgrade');

function ws(path, handler) {
  routes.set(path, handler);
}

/**
 * Parse the target of an upgrade request without throwing. WebSocket
 * upgrades use the origin form ("/path?query"): anything else is malformed.
 * The pathname is kept as sent, like Express routing does.
 */
function parseTarget(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) {
    return null;
  }
  try {
    const { searchParams } = new URL(url, 'http://localhost');
    return {
      pathname: url.split(/[?#]/)[0],
      query: Object.fromEntries(searchParams),
    };
  } catch (err) {
    return null;
  }
}

function reject(socket, status, message) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

// Find the handler of a route, matching case like Express routing does
function findRoute(pathname, caseSensitive) {
  if (caseSensitive) {
    return routes.get(pathname);
  }
  const lowerCase = pathname.toLowerCase();
  for (const [route, handler] of routes) {
    if (route.toLowerCase() === lowerCase) {
      return handler;
    }
  }
}

function handleUpgrade(request, socket, head) {
  const target = parseTarget(request.url);
  if (!target) {
    return reject(socket, 400, 'Bad Request');
  }
  request.query = target.query;

  const handler = findRoute(target.pathname, false);
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
  const handler = findRoute(
    req.path,
    req.app.enabled('case sensitive routing')
  );
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

module.exports = {
  ws,
  handleUpgrade,
  middleware,
  dispatch,
  parseTarget,
  reject,
};
