const debug = require('debug')('hyperwatch:express');
const { Map } = require('immutable');

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
 * @property {{ path?: string | null, name?: string | null } | null} [route]
 *   The route of the request, set by the application before the response
 *   ends: its fields replace the ones read from Express (`null`: no route).
 *   See docs/log.md, "Route".
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
              const route = routeOf(req);
              if (route) {
                req.hyperwatch.rawLog = req.hyperwatch.rawLog.set(
                  'route',
                  Map(route)
                );
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
 * `path`, the path of the Express route that handled it as written in the
 * application, after its router's (`req.baseUrl`), the paths of an array
 * joined with `,`. The fields the application set in `req.hyperwatch.route`
 * win (`name` comes only from there). No route without a `path`. Reading it
 * never loses the log: what can't be read is left out.
 * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
 * @returns {{ path: string, name?: string } | undefined}
 */
function routeOf(req) {
  try {
    return readRoute(req);
  } catch (err) {
    debug(`Can't read the route: %s`, err);
    return undefined;
  }
}

/**
 * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
 * @returns {{ path: string, name?: string } | undefined}
 */
function readRoute(req) {
  const own = req.hyperwatch.route;
  if (own === null) {
    return undefined;
  }
  /** @type {{ path?: unknown } | undefined} */
  const expressRoute = req.route;

  /** @type {{ path?: unknown, name?: unknown }} */
  const fields = {};
  if (expressRoute) {
    const { path } = expressRoute;
    const text = Array.isArray(path)
      ? path.map((p) => pathText(p) || '').join(',')
      : pathText(path);
    if (text !== undefined) {
      fields.path = `${req.baseUrl || ''}${text}`;
    }
  }
  if (own && typeof own === 'object') {
    for (const key of /** @type {const} */ (['path', 'name'])) {
      if (own[key] !== undefined) {
        fields[key] = own[key];
      }
    }
  }

  if (!fields.path) {
    return undefined;
  }
  /** @type {{ path: string, name?: string }} */
  const route = { path: String(fields.path) };
  if (fields.name) {
    route.name = String(fields.name);
  }
  return route;
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
/** @typedef {import('../lib/pipeline').InputHandlers} InputHandlers */
