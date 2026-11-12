const { fromJS } = require('immutable');

const app = require('../app/api');

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {string} options.path The path where to listen for logs
 * @param {(message: any) => Log} [options.parse] Parses a message of the
 *   request's body (parsed JSON) into a log
 * @returns {Input}
 */
function create({ name = 'HTTP server', path, parse = fromJS }) {
  return {
    name: name,
    start: ({ success, reject, status }) => {
      app.post(path, (req, res) => {
        // No validation before sending the response to the client
        res.send('Ok');
        // Processing the message(s)
        // Express 5 leaves req.body undefined when no body parser matched
        if (req.body === undefined) {
          return;
        }
        const messages = Array.isArray(req.body) ? req.body : [req.body];
        messages.forEach((message) => {
          try {
            success(parse(message));
          } catch (err) {
            reject(err);
          }
        });
      });
      status(null, `Listening on http://__HOST__${path}`);
    },
  };
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
