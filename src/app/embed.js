const api = require('./api');
const wsServer = require('./ws-server');

/**
 * Embed Hyperwatch in an Express app, under an explicit mount path.
 *
 *   const hw = hyperwatch.app.embed('/_hyperwatch');
 *   app.use(hw.path, auth, hw.router);
 *   const detach = hw.attach(server, app);
 *
 * Hyperwatch owns the WebSocket upgrades under `path`, and only those.
 */
function embed(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.endsWith('/')) {
    throw new TypeError(
      `Invalid mount path "${path}": it must start with "/" and not end with "/"`
    );
  }

  const listeners = new Map();

  /**
   * Whether a request is under the mount path, matching case like the Express
   * app it's mounted on (case-insensitive by default, like Express).
   */
  function owns(req, { caseSensitive = false } = {}) {
    const target = wsServer.parseTarget(req.url);
    if (!target) {
      return false;
    }
    const pathname = caseSensitive
      ? target.pathname
      : target.pathname.toLowerCase();
    const mountPath = caseSensitive ? path : path.toLowerCase();
    return pathname === mountPath || pathname.startsWith(`${mountPath}/`);
  }

  /**
   * Handle the WebSocket upgrades of `server` under the mount path, by sending
   * them through `app` (where `router` is mounted). Other upgrades are passed
   * to `fallback` when given, or left to the server's other listeners.
   * Returns a function removing the listener.
   */
  function attach(server, app, { fallback } = {}) {
    if (listeners.has(server)) {
      throw new Error(
        `Hyperwatch is already attached to this server on ${path}`
      );
    }
    const listener = (req, socket, head) => {
      // Malformed targets are rejected before reaching the app or fallback
      if (!wsServer.parseTarget(req.url)) {
        return wsServer.reject(socket, 400, 'Bad Request');
      }
      const caseSensitive = app.enabled('case sensitive routing');
      if (owns(req, { caseSensitive })) {
        wsServer.dispatch(app, req, socket, head);
      } else if (fallback) {
        fallback(req, socket, head);
      }
    };
    server.on('upgrade', listener);
    listeners.set(server, listener);

    return function detach() {
      if (listeners.get(server) === listener) {
        server.off('upgrade', listener);
        listeners.delete(server);
      }
    };
  }

  return { path, router: api, owns, attach };
}

module.exports = embed;
