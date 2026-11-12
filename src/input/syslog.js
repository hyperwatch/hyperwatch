const { fromJS } = require('immutable');
// syslog-parse is ESM-only with a default export
const syslogParse = require('syslog-parse').default;

const socket = require('./socket');

/** @param {string} s */
const defaultParse = (s) => fromJS(JSON.parse(s));

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {'udp' | 'tcp'} [options.protocol] Both when not set
 * @param {number} [options.port] 514 by default
 * @param {(message: string) => Log} [options.parse] Parses the message of a
 *   syslog line into a log
 * @param {number} [options.sample] The share of logs kept, between 0 and 1
 * @returns {Input}
 */
function create({
  name = 'Syslog',
  protocol,
  port = 514,
  parse = defaultParse,
  sample = 1,
}) {
  return {
    name: name,
    start: ({ success, reject, status, log }) => {
      const handler = (/** @type {string} */ message) => {
        if (sample !== 1 && Math.random() > sample) {
          return;
        }
        try {
          const result = syslogParse(message);
          if (!result) {
            throw new Error('Unparseable syslog message');
          }
          success(parse(result.message));
        } catch (err) {
          reject(err);
        }
      };
      if (!protocol || protocol === 'udp') {
        socket.createUdpServer({ status, port, handler });
      }
      if (!protocol || protocol === 'tcp') {
        socket.createTcpServer({ status, log, port, handler });
      }
    },
  };
}

module.exports = {
  create: create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
