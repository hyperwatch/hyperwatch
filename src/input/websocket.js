const { fromJS } = require('immutable');
const WebSocket = require('ws');

const wsServer = require('../app/ws-server');

/** @param {Buffer | ArrayBuffer | Buffer[] | string} s */
const defaultParse = (s) => fromJS(JSON.parse(/** @type {string} */ (s)));

// A connection closed this soon after opening, before any message, was cut
// by the server, e.g. a Hyperwatch server already streaming to this clientId
// (behind a load balancer, another server may not be)
const CUT_WITHIN = 1000;
// A connection that received a message, or stayed open this long, worked:
// the next reconnect starts over from the first attempt
const HEALTHY_AFTER = 10 * 1000;

// After a cut, retry soon, 1 more second each time up to 10s. Otherwise back
// off from 10s, doubling up to 5 minutes.
/**
 * @param {number} attempts
 * @param {boolean} cut
 */
function reconnectDelay(attempts, cut) {
  return cut
    ? Math.min(1000 * attempts, 10 * 1000)
    : Math.min(10 * 1000 * Math.pow(2, attempts - 1), 5 * 60 * 1000);
}

// The server's X-Hyperwatch-Version, when it looks like a version (5.1.0,
// 5.1.0-beta.1+build). Statuses end up unescaped in HTML pages: anything else
// from the server is left out.
/**
 * @param {import('http').IncomingMessage} response
 * @returns {string | undefined}
 */
function versionOf(response) {
  // A custom header is a string, when the server sends it
  const version = /** @type {string | undefined} */ (
    response.headers['x-hyperwatch-version']
  );
  // Without one, test() reads 'undefined': undefined is returned anyway
  return /^[0-9A-Za-z.+-]{1,32}$/.test(/** @type {string} */ (version))
    ? version
    : undefined;
}

/**
 * @typedef {object} WebSocketInputOptions
 * @property {string} [name]
 * @property {'client' | 'server'} [type] Connect to `address` (default), or
 *   receive logs at `path`
 * @property {string} [address] The WebSocket address to connect to
 * @property {string} [path] The path where to listen for logs
 * @property {string} [username] Basic authentication, with `password`
 * @property {string} [password]
 * @property {Record<string, any>} [options] Options of ws's WebSocket client
 *   (`headers`, `rejectUnauthorized`…)
 * @property {(message: Buffer | ArrayBuffer | Buffer[] | string) => any} [parse]
 *   Parses a message into a log (ws gives a Buffer, unless configured
 *   otherwise)
 * @property {number} [sample] The share of logs kept, between 0 and 1
 * @property {boolean} [reconnectOnClose]
 * @property {number} [heartbeatInterval] Milliseconds between pings
 */

/**
 * @param {WebSocketInputOptions} options
 * @returns {Input}
 */
function create({
  name = 'WebSocket',
  address,
  path,
  username,
  password,
  options = {},
  type = 'client',
  parse = defaultParse,
  sample = 1,
  reconnectOnClose = false,
  heartbeatInterval = 30000,
}) {
  /** @type {WebSocket | undefined} */
  let client;
  /** @type {NodeJS.Timeout | undefined} */
  let keepAlive;
  /** @type {NodeJS.Timeout | undefined} */
  let reconnectTimer;
  // Each connection belongs to a generation. stop() and every new connection
  // move to the next one, so events from an obsolete socket (a late close
  // after a restart, its heartbeat) can't reconnect or touch the current one.
  let generation = 0;

  let reconnectAttempts = 0;

  /** @param {Pick<InputHandlers, 'status' | 'success' | 'reject'>} handlers */
  const setupWebSocketClient = ({ status, success, reject }) => {
    const current = ++generation;
    const isCurrent = () => current === generation;
    /** @type {boolean | undefined} */
    let isAlive;
    /** @type {NodeJS.Timeout | undefined} */
    let heartbeat;
    /** @type {number | undefined} */
    let openedAt;
    let received = false;
    // The server's X-Hyperwatch-Version, when it sends one
    /** @type {string | undefined} */
    let serverVersion;

    if (username && password) {
      options.headers = options.headers || {};
      options.headers.authorization = `Basic ${Buffer.from(
        `${username}:${password}`
      ).toString('base64')}`;
    }

    // A client has an address
    const socket = new WebSocket(/** @type {string} */ (address), [], options);
    client = socket;
    status(null, `Waiting for connection to ${address}`);

    socket.on('upgrade', (response) => {
      serverVersion = versionOf(response);
    });

    socket.on('open', () => {
      if (!isCurrent()) {
        return;
      }
      isAlive = true;
      openedAt = Date.now();
      status(
        null,
        `Listening to ${address}${
          serverVersion ? ` (Hyperwatch ${serverVersion})` : ''
        }`
      );

      // Heartbeat: detect stale connections
      heartbeat = setInterval(() => {
        if (isAlive === false) {
          socket.terminate();
          clearInterval(heartbeat);
        } else {
          try {
            socket.ping();
          } catch (err) {
            status(err, 'Websocket error');
          }
          isAlive = false;
        }
      }, heartbeatInterval);
      keepAlive = heartbeat;
    });

    socket.on('message', (message) => {
      if (!isCurrent()) {
        return;
      }
      received = true;
      if (sample !== 1 && Math.random() > sample) {
        return;
      }
      try {
        success(parse(message));
      } catch (err) {
        reject(err);
      }
    });

    socket.on('error', (err) => {
      if (isCurrent()) {
        status(err, 'Websocket error');
      }
    });

    socket.on('pong', () => {
      isAlive = true;
    });

    socket.on('close', () => {
      clearInterval(heartbeat);
      if (!isCurrent()) {
        return;
      }
      const openFor = openedAt ? Date.now() - openedAt : null;
      const cut = openFor !== null && openFor < CUT_WITHIN && !received;
      status(
        null,
        cut
          ? 'Websocket connection has been closed by the server right after opening'
          : 'Websocket connection has been closed'
      );
      if (reconnectOnClose) {
        // Never opened (null): not healthy
        if (received || /** @type {number} */ (openFor) >= HEALTHY_AFTER) {
          reconnectAttempts = 0;
        }
        reconnectAttempts++;
        const delay = reconnectDelay(reconnectAttempts, cut);
        status(
          null,
          `Reconnecting Websocket in ${delay / 1000}s (attempt ${reconnectAttempts})`
        );
        reconnectTimer = setTimeout(() => {
          setupWebSocketClient({ status, success, reject });
        }, delay);
      }
    });
  };

  /** @param {Pick<InputHandlers, 'status' | 'success' | 'reject'>} handlers */
  const setupWebSocketServer = ({ status, success, reject }) => {
    // A server has a path
    wsServer.ws(/** @type {string} */ (path), (ws) => {
      ws.on('message', (message) => {
        if (sample !== 1 && Math.random() > sample) {
          return;
        }
        try {
          success(parse(message));
        } catch (err) {
          reject(err);
        }
      });
    });
    status(null, `Listening on ws://__HOST__${path}`);
  };

  return {
    name: `${name} ${type}`,
    start: ({ success, reject, status, log }) => {
      reconnectAttempts = 0;
      if (type === 'client') {
        setupWebSocketClient({ status, success, reject });
      } else if (type === 'server') {
        setupWebSocketServer({ status, success, reject });
      } else {
        const errMsg = 'WebSocket type is either client or server';
        log(new Error(errMsg), 'error');
      }
    },
    // Never throws: a failing input must not prevent the others from stopping,
    // nor Hyperwatch from persisting its data on shutdown.
    stop: () => {
      // Obsoletes the current connection: its close won't reconnect
      generation++;
      clearTimeout(reconnectTimer);
      clearInterval(keepAlive);
      if (!client) {
        return;
      }
      try {
        if (client.readyState === WebSocket.CONNECTING) {
          // close() throws while the connection is not established yet
          client.terminate();
        } else if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      } catch (/** @type {any} */ err) {
        console.error(
          `${name}: error while closing the Websocket:`,
          err.message
        );
      }
    },
  };
}

module.exports = {
  create: create,
};

/** @typedef {import('../lib/pipeline').Input} Input */
/** @typedef {import('../lib/pipeline').InputHandlers} InputHandlers */
