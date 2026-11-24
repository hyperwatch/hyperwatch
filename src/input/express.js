const debug = require('debug')('hyperwatch:express');

const { createLog } = require('../lib/util');
const modules = require('../modules');

/**
 * What the middleware adds to a request, as `req.hyperwatch`
 * @typedef {object} HyperwatchRequest
 * @property {Log} rawLog
 * @property {Date} startedAt
 * @property {(options?: { fast?: boolean }) => Promise<Log>} getAugmentedLog
 *   The log augmented by the active modules (`fast`: with what they have
 *   in cache only)
 * @property {string | null} [route] The route of the request, set by the
 *   application before the response ends: it replaces the one read from
 *   Express (`null` or `''`: no route). See docs/log.md, "Route".
 * @property {string | null} [handler] The name of the function handling the
 *   request, set by the application: it replaces the one read from Express
 *   (`null` or `''`: none).
 */

/**
 * The Express input: an input with a middleware. `start()` keeps the
 * handlers for it.
 * @typedef {Input & Partial<Pick<InputHandlers, 'success' | 'reject' | 'status'>> & {
 *   middleware: () => import('express').RequestHandler,
 * }} ExpressInput
 */

/**
 * @param {{ name?: string, app?: import('express').Application }} [options]
 *   `app`: add the middleware to it when starting
 * @returns {ExpressInput}
 */
function create({ name = 'Express Middleware', app } = {}) {
  return {
    name: name,
    // Set by start()
    success: undefined,
    reject: undefined,
    status: undefined,
    start: function ({ success, reject, status }) {
      this.success = success;
      this.reject = reject;
      this.status = status;
      status(null, `Listening.`);
      if (app) {
        app.use(this.middleware());
      }
    },
    middleware: function () {
      // `req.hyperwatch` is set below: the request is typed as having it
      return /** @type {import('express').RequestHandler} */ (
        /**
         * @this {ExpressInput}
         * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
         * @param {import('express').Response} res
         * @param {import('express').NextFunction} next
         */ function (req, res, next) {
          req.hyperwatch =
            req.hyperwatch || /** @type {HyperwatchRequest} */ ({});
          req.hyperwatch.rawLog = createLog(req, res);
          req.hyperwatch.startedAt = new Date();

          req.hyperwatch.getAugmentedLog = async (
            /** @type {{ fast?: boolean }} */ { fast = false } = {}
          ) => {
            let log = req.hyperwatch.rawLog;
            for (const module of modules.activeModules()) {
              if (module && module.augment) {
                log = await module.augment(log, { fast });
              }
            }
            return log;
          };

          res.on('finish', () => {
            const { success, reject } = this;
            try {
              const executionTime =
                Date.now() - req.hyperwatch.startedAt.getTime();
              req.hyperwatch.rawLog = req.hyperwatch.rawLog
                .setIn(['response', 'status'], res.statusCode)
                .set('executionTime', executionTime);
              for (const [field, value] of routeOf(req)) {
                req.hyperwatch.rawLog = req.hyperwatch.rawLog.set(field, value);
              }
              if (success) {
                success(req.hyperwatch.rawLog);
              }
            } catch (err) {
              if (reject) {
                reject(err);
              }
            }
          });
          next();
        }.bind(this)
      );
    },
  };
}

/**
 * A path a route is declared with, as written in the application: a string
 * as is, a regular expression as its literal (`/^\/(?<slug>[^/]+)$/i`)
 * @param {unknown} path
 * @returns {string | undefined}
 */
function pathText(path) {
  if (typeof path === 'string') {
    return path;
  }
  if (path instanceof RegExp) {
    return String(path);
  }
  return undefined;
}

/**
 * The route of a request, with the meaning of OpenTelemetry's `http.route`:
 * the path of the Express route that handled it, as written in the
 * application, after its router's (`req.baseUrl`); the paths of an array
 * joined with `,`. And `handler`: the name of the route's last function.
 * What the application set in `req.hyperwatch` wins. Reading them never loses
 * the log: what can't be read is left out.
 * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
 * @returns {[string, string][]}
 */
function routeOf(req) {
  try {
    return readRoute(req);
  } catch (err) {
    debug(`Can't read the route: %s`, err);
    return [];
  }
}

/**
 * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
 * @returns {[string, string][]}
 */
function readRoute(req) {
  /** @type {[string, string][]} */
  const fields = [];
  const { route: ownRoute, handler: ownHandler } = req.hyperwatch;
  /** @type {{ path?: unknown, methods?: Record<string, boolean>, stack?: { name?: string, method?: string }[] } | undefined} */
  const expressRoute = req.route;

  let route;
  if (ownRoute !== undefined) {
    route = ownRoute === null ? undefined : String(ownRoute);
  } else if (expressRoute) {
    const { path } = expressRoute;
    const text = Array.isArray(path)
      ? path.map((p) => pathText(p) || '').join(',')
      : pathText(path);
    route = text === undefined ? undefined : `${req.baseUrl || ''}${text}`;
  }
  if (route) {
    fields.push(['route', route]);
  }

  let handler;
  if (ownHandler !== undefined) {
    handler = ownHandler === null ? undefined : String(ownHandler);
  } else if (expressRoute && Array.isArray(expressRoute.stack)) {
    // The functions of the request's method (and of `.all()`), as Express
    // picks them: a route can have several methods (`app.route(path)`)
    let method = String(req.method || '').toLowerCase();
    if (method === 'head' && !(expressRoute.methods || {}).head) {
      method = 'get';
    }
    const layers = expressRoute.stack.filter(
      (layer) => !layer.method || layer.method === method
    );
    const last = layers[layers.length - 1];
    const name = last && last.name;
    handler = name && name !== '<anonymous>' ? name : undefined;
  }
  if (handler) {
    fields.push(['handler', handler]);
  }
  return fields;
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
/** @typedef {import('../lib/pipeline').InputHandlers} InputHandlers */
