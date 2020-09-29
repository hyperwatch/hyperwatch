const { createLog } = require('../lib/util');
const modules = require('../modules');

function create({ name = 'Express Middleware', app } = {}) {
  return {
    name: name,
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

        req.hyperwatch.getAugmentedLog = async ({ fast = false } = {}) => {
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
            const executionTime = new Date() - req.hyperwatch.startedAt;
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
