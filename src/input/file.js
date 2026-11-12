const { fromJS } = require('immutable');
const { Tail } = require('tail');

/** @param {string} s */
const defaultParse = (s) => fromJS(JSON.parse(s));

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {string} options.path The path of the file
 * @param {(line: string) => Log} [options.parse] Parses a line into a log
 * @returns {Input}
 */
function create({ name = 'File', path, parse = defaultParse }) {
  return {
    name: name,
    start: ({ success, reject, status, log }) => {
      let tail;
      try {
        tail = new Tail(path, {
          logger: {
            info: () => {},
            error: (/** @type {Error} */ err) => status(err, err.message),
          },
        });
      } catch (/** @type {any} */ err) {
        return status(err, err.message);
      }
      tail.on('line', (data) => {
        try {
          success(parse(data));
        } catch (err) {
          reject(err);
        }
      });
      tail.on('error', (err) => {
        log(err, 'error');
      });
      tail.watch();
      status(null, `Watching ${path}`);
    },
  };
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
