const dgram = require('dgram');
const net = require('net');

const { fromJS } = require('immutable');

/** @param {string} s */
const defaultParse = (s) => fromJS(JSON.parse(s));

/**
 * @param {object} options
 * @param {InputHandlers['status']} options.status
 * @param {InputHandlers['log']} options.log
 * @param {number} options.port
 * @param {(line: string) => void} options.handler Called with each line
 * @returns {import('net').Server}
 */
function createTcpServer({ status, log, port, handler }) {
  return (
    net
      .createServer((socket) => {
        socket.on('data', (data) => {
          data
            .toString()
            .split('\n')
            .forEach((line) => {
              if (line) {
                handler(line);
              }
            });
        });
        socket.on('error', (err) => {
          log(err, 'error');
        });
      })
      // Listen errors are 'error' events: the callback gets none
      .listen(port, () => {
        status(null, `Listening on TCP port ${port}.`);
      })
  );
}

/**
 * @param {object} options
 * @param {InputHandlers['status']} options.status
 * @param {number} options.port
 * @param {(line: string) => void} options.handler Called with each line
 * @returns {import('dgram').Socket}
 */
function createUdpServer({ status, port, handler }) {
  return dgram
    .createSocket('udp4')
    .on('message', (message) => {
      message
        .toString()
        .split('\n')
        .forEach((line) => {
          if (line) {
            handler(line);
          }
        });
    })
    .on('error', (err) => {
      status(err, `Cannot start: ${err.message}`);
    })
    .on('listening', () => {
      status(null, `Listening on UDP port ${port}.`);
    })
    .bind(port);
}

/**
 * @param {object} options
 * @param {string} [options.name]
 * @param {'udp' | 'tcp'} [options.protocol] Both when not set
 * @param {number} options.port
 * @param {(line: string) => Log} [options.parse] Parses a line into a log
 * @param {number} [options.sample] The share of logs kept, between 0 and 1
 * @returns {Input}
 */
function create({
  name = 'Socket',
  protocol,
  port,
  parse = defaultParse,
  sample = 1,
}) {
  /** @type {import('dgram').Socket | undefined} */
  let udpServer;
  /** @type {import('net').Server | undefined} */
  let tcpServer;
  return {
    name: name,
    start: ({ success, reject, status, log }) => {
      const handler = (/** @type {string} */ message) => {
        if (sample !== 1 && Math.random() > sample) {
          return;
        }
        try {
          success(parse(message));
        } catch (err) {
          reject(err);
        }
      };
      if (!protocol || protocol === 'udp') {
        udpServer = createUdpServer({ status, port, handler });
      }
      if (!protocol || protocol === 'tcp') {
        tcpServer = createTcpServer({ status, log, port, handler });
      }
    },
    stop: () => {
      // TCP: resolved with the error of close(), if any
      /** @type {Promise<Error | void>[]} */
      const promises = [];
      if (udpServer) {
        promises.push(
          new Promise((resolve) =>
            /** @type {import('dgram').Socket} */ (udpServer).close(resolve)
          )
        );
      }
      if (tcpServer) {
        promises.push(
          new Promise((resolve) =>
            /** @type {import('net').Server} */ (tcpServer).close(resolve)
          )
        );
      }
      return Promise.all(promises);
    },
  };
}

module.exports = {
  createTcpServer,
  createUdpServer,
  create,
};

/** @typedef {import('../types').Log} Log */
/** @typedef {import('../lib/pipeline').Input} Input */
/** @typedef {import('../lib/pipeline').InputHandlers} InputHandlers */
