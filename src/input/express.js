const { createLog } = require('../lib/util');
const modules = require('../modules');

/**
 * The Express input. Once the pipeline started it, `success(log)` and
 * `reject(reason)` are the pipeline's handlers: an app that builds its own
 * logs calls them instead of using `middleware()`.
 * @typedef {object} ExpressInput
 * @property {string} name
 * @property {(handlers: import('../lib/pipeline').InputHandlers) => void} start
 * @property {() => import('express').RequestHandler} middleware
 * @property {(log: import('../types').Log) => void} success
 * @property {(reason: any) => void} reject
 * @property {(err: any, message?: string) => void} status
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
      return function (req, res, next) {
        req.hyperwatch = req.hyperwatch || {};
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
      }.bind(this);
    },
  };
}

module.exports = {
  create: create,
};
