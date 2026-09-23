const api = require('./api');
const wsServer = require('./ws-server');

// Servers where Hyperwatch handles WebSocket upgrades, with their listener
const upgradeListeners = new WeakMap();

function validate(app, { server, path, middleware, fallback }) {
  if (typeof app !== 'function' || typeof app.use !== 'function') {
    throw new TypeError('mount() expects an Express app');
  }
  if (!server || typeof server.on !== 'function') {
    throw new TypeError(
      'mount() expects the HTTP server of the app: { server }'
    );
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.endsWith('/')) {
    throw new TypeError(
      `Invalid mount path "${path}": it must start with "/" and not end with "/"`
    );
  }
  const middlewares = middleware === undefined ? [] : [].concat(middleware);
  if (!middlewares.every((fn) => typeof fn === 'function')) {
    throw new TypeError(
      'middleware must be a function or an array of functions'
    );
  }
  if (fallback !== undefined && typeof fallback !== 'function') {
    throw new TypeError('fallback must be a function');
  }
  if (upgradeListeners.has(server)) {
    throw new Error('Hyperwatch is already mounted on this server');
  }
  return middlewares;
}

// Whether a request is under the mount path, matching case like Express
function isUnderPath(target, path, caseSensitive) {
  const pathname = caseSensitive
    ? target.pathname
    : target.pathname.toLowerCase();
  const mountPath = caseSensitive ? path : path.toLowerCase();
  return pathname === mountPath || pathname.startsWith(`${mountPath}/`);
}

/**
 * Mount Hyperwatch in an Express app, under an explicit path:
 *
 *   hyperwatch.app.mount(app, { server, path: '/_hyperwatch', middleware: auth });
 *
 * - Registers `app.use(path, ...middleware, router)` where it's called, so the
 *   app's middleware order is kept.
 * - Adds one 'upgrade' listener to `server`. WebSocket upgrades under `path`
 *   go through the app like HTTP requests, so `middleware` applies to both.
 *   Other upgrades go to `fallback` when given, or are left to the server's
 *   other listeners. Malformed targets get 400.
 * - Never creates a server nor listens.
 *
 * Mounting twice on the same server throws, before registering anything.
 * Returns `{ path, detachUpgrades }`: detachUpgrades() removes the upgrade
 * listener and releases the server. Express can't remove routes, so the
 * HTTP routes stay mounted on the app.
 */
function mount(app, options = {}) {
  const middlewares = validate(app, options);
  const { server, path, fallback } = options;

  app.use(path, ...middlewares, api);

  const listener = (req, socket, head) => {
    const target = wsServer.parseTarget(req.url);
    // Malformed targets are rejected before reaching the app or fallback
    if (!target) {
      return wsServer.reject(socket, 400, 'Bad Request');
    }
    if (isUnderPath(target, path, app.enabled('case sensitive routing'))) {
      wsServer.dispatch(app, req, socket, head);
    } else if (fallback) {
      fallback(req, socket, head);
    }
  };
  server.on('upgrade', listener);
  upgradeListeners.set(server, listener);

  return {
    path,
    detachUpgrades() {
      if (upgradeListeners.get(server) === listener) {
        server.off('upgrade', listener);
        upgradeListeners.delete(server);
      }
    },
  };
}

module.exports = mount;
