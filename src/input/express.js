const onFinished = require('on-finished');

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
        app.use(this.middleware);
      }
    },
    middleware: function (req, res, next) {
      req.startAt = new Date();
      onFinished('res', () => {
        const { success, reject } = this;
        req.endAt = new Date();
        try {
          const executionTime = req.endAt - req.startAt;
          const log = createLog(req, res).set('executionTime', executionTime);
          if (success) {
            success(log);
          }
        } catch (err) {
          if (reject) {
            reject(err);
          }
        }
      });
      next();
    },
  };
}

module.exports = {
  create: create,
};
