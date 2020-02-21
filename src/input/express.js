const { createLog } = require('../lib/util');

function create({ name = 'Express Middleware', app }) {
  return {
    name: name,
    start: ({ success, reject, status }) => {
      app.use((req, res, next) => {
        try {
          const log = createLog(req, res);
          success(log);
        } catch (err) {
          reject(err);
        }
        next();
      });
      status(null, `Listening.`);
    },
  };
}

module.exports = {
  create: create,
};
