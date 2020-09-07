const { createLog } = require('../lib/util');

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
        req.rawLog = createLog(req, res);
        req.startAt = new Date();
        res.on('finish', () => {
          const { success, reject } = this;
          req.endAt = new Date();
          try {
            const executionTime = req.endAt - req.startAt;
            req.rawLog = req.rawLog
              .setIn(['response', 'status'], res.statusCode)
              .set('executionTime', executionTime);
            if (success) {
              success(req.rawLog);
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
