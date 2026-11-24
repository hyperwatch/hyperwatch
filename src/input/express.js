const debug = require('debug')('hyperwatch:express');

const route = require('../lib/route');
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
 *   Express (`null`: no route). See docs/log.md, "Route".
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
              const value = routeOf(req);
              if (value) {
                req.hyperwatch.rawLog = req.hyperwatch.rawLog.set(
                  'route',
                  value
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
 * The route of a request: the application's (`req.hyperwatch.route`), else
 * the one Express matched. A route that can't be read is left out rather
 * than losing the log.
 * @param {import('express').Request & { hyperwatch: HyperwatchRequest }} req
 * @returns {string | undefined}
 */
function routeOf(req) {
  const own = req.hyperwatch.route;
  if (own === null) {
    return undefined;
  }
  try {
    if (own !== undefined) {
      return route.normalize(String(own));
    }
    return route.fromExpressRequest(req);
  } catch (err) {
    debug(`Can't read the route: %s`, err);
    return undefined;
  }
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
/** @typedef {import('../lib/pipeline').InputHandlers} InputHandlers */
