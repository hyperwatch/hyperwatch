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

  // Whether an upgrade request is for this mount path
  function owns(req) {
    const { pathname } = new URL(req.url, 'http://localhost');
    return pathname === path || pathname.startsWith(`${path}/`);
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
      if (owns(req)) {
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
