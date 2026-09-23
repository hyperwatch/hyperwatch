const http = require('http');

const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ noServer: true });

const routes = new Map();

// Marks an upgrade request forwarded through an Express app by attach()
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
 * Express middleware completing the WebSocket upgrades forwarded by attach().
 * The route is matched on the path relative to where the middleware is
 * mounted, so `app.use('/_hyperwatch', middleware)` serves `/_hyperwatch/logs/raw`.
 */
function middleware(req, res, next) {
  const upgrade = req[upgradeKey];
  const handler = upgrade && routes.get(req.path);
  if (!handler) {
    return next();
  }
  req[upgradeKey] = null;
  res.detachSocket(upgrade.socket);
  wss.handleUpgrade(req, upgrade.socket, upgrade.head, (client) => {
    handler(client, req);
  });
}

// Whether a request path could reach a Hyperwatch WebSocket route,
// whatever the prefix the middleware is mounted on.
function isHyperwatchPath(pathname) {
  for (const route of routes.keys()) {
    if (pathname.endsWith(route)) {
      return true;
    }
  }
  return false;
}

/**
 * Route the WebSocket upgrades of an HTTP server through an Express app, so
 * they go through its middlewares (authentication, mount path…) and reach
 * the Hyperwatch WebSocket middleware. Upgrades for other paths are left
 * untouched for other listeners.
 *
 * Hyperwatch upgrades are not dispatched to the server's other 'upgrade'
 * listeners: some, like the one Next.js registers on its custom server,
 * close the sockets of the requests they don't serve, which would close
 * the Hyperwatch WebSocket right after it opens.
 */
function attach(server, app) {
  const handle = (req, socket, head) => {
    req[upgradeKey] = { socket, head };

    // A response bound to the socket, so middlewares can reject the upgrade
    // with a regular HTTP response (e.g. 401 from an authentication middleware)
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    res.on('finish', () => socket.end());

    app(req, res, () => {
      if (req[upgradeKey]) {
        res.statusCode = 404;
        res.end();
      }
    });
  };

  // Node only emits 'upgrade' events when the server has a listener
  server.on('upgrade', () => {});

  const emit = server.emit;
  server.emit = function (event, ...args) {
    if (event === 'upgrade') {
      const [req, socket, head] = args;
      const { pathname } = new URL(req.url, 'http://localhost');
      if (isHyperwatchPath(pathname)) {
        handle(req, socket, head);
        return true;
      }
    }
    return emit.call(this, event, ...args);
  };
}

module.exports = { ws, handleUpgrade, middleware, attach };
