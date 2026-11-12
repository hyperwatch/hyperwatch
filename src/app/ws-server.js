const http = require('http');

const { WebSocketServer } = require('ws');

const version = require('../version');

const wss = new WebSocketServer({ noServer: true });

// Every handshake tells the client which Hyperwatch it talks to
wss.on('headers', (headers) => {
  headers.push(`X-Hyperwatch-Version: ${version}`);
});

/** @type {Map<string, Handler>} */
const routes = new Map();

// Marks an upgrade request dispatched through an Express app
const upgradeKey = Symbol('hyperwatch.upgrade');

/**
 * @param {string} path
 * @param {Handler} handler
 */
function ws(path, handler) {
  routes.set(path, handler);
}

/**
 * Parse the target of an upgrade request without throwing. WebSocket
 * upgrades use the origin form ("/path?query"): anything else is malformed.
 * `pathname` is kept as sent, like Express routing does; `urlPathname` is
 * normalized by the URL parser.
 * @param {unknown} url
 */
function parseTarget(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) {
    return null;
  }
  try {
    const { pathname: urlPathname, searchParams } = new URL(
      url,
      'http://localhost'
    );
    return {
      pathname: url.split(/[?#]/)[0],
      urlPathname,
      query: Object.fromEntries(searchParams),
    };
  } catch (err) {
    return null;
  }
}

/**
 * @param {import('stream').Duplex} socket
 * @param {number} status
 * @param {string} message
 */
function reject(socket, status, message) {
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
}

// Find the handler of a route, matching case like Express routing does
/**
 * @param {string} pathname
 * @param {boolean} caseSensitive
 * @returns {Handler | undefined}
 */
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

/**
 * @param {import('http').IncomingMessage & { query?: Record<string, string> }} request
 * @param {import('stream').Duplex} socket
 * @param {Buffer} head
 */
function handleUpgrade(request, socket, head) {
  const target = parseTarget(request.url);
  if (!target) {
    return reject(socket, 400, 'Bad Request');
  }
  request.query = target.query;

  // Standalone mode: exact match, stream names are case-sensitive
  const handler = routes.get(target.urlPathname);
  if (handler) {
    wss.handleUpgrade(request, socket, head, (client) => {
      handler(client, /** @type {UpgradeRequest} */ (request));
    });
  } else {
    socket.destroy();
  }
}

/**
 * Express middleware completing the WebSocket upgrades sent by dispatch().
 * The route is matched on the path relative to where the middleware is
 * mounted, so `app.use('/_hyperwatch', middleware)` serves `/_hyperwatch/logs/raw`.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function middleware(req, res, next) {
  const upgrade = /** @type {Dispatched} */ (req)[upgradeKey];
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
  /** @type {Dispatched} */ (req)[upgradeKey] = null;
  res.detachSocket(/** @type {import('net').Socket} */ (upgrade.socket));
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
 * @param {import('express').Express} app
 * @param {import('http').IncomingMessage} req
 * @param {import('stream').Duplex} socket
 * @param {Buffer} head
 */
function dispatch(app, req, socket, head) {
  /** @type {Dispatched} */ (req)[upgradeKey] = { socket, head };
  const res = new http.ServerResponse(req);
  res.assignSocket(/** @type {import('net').Socket} */ (socket));
  res.on('finish', () => socket.end());
  app(req, res);
}

/**
 * A WebSocket connection, as handlers use it (a WebSocket of the ws package)
 * @typedef {object} WebSocketClient
 * @property {number} readyState
 * @property {(data: string) => void} send
 * @property {() => void} ping
 * @property {() => void} terminate
 * @property {(event: string, listener: (...args: any[]) => void) => unknown} on
 */

/**
 * The request of a WebSocket upgrade, with its query string parsed
 * @typedef {import('http').IncomingMessage & { query: Record<string, unknown> }} UpgradeRequest
 */

/**
 * Handles the connections of a WebSocket route
 * @typedef {(client: WebSocketClient, req: UpgradeRequest) => void} Handler
 */

/**
 * A request carrying the upgrade dispatch() sends through an app
 * @typedef {import('http').IncomingMessage & {
 *   [upgradeKey]?: { socket: import('stream').Duplex, head: Buffer } | null,
 * }} Dispatched
 */

module.exports = {
  ws,
  handleUpgrade,
  middleware,
  dispatch,
  parseTarget,
  reject,
};
