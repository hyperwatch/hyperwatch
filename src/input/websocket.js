const { fromJS } = require('immutable');
const WebSocket = require('ws');

const wsServer = require('../app/ws-server');

const defaultParse = (s) => fromJS(JSON.parse(s));

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
  let client;
  let keepAlive;
  let reconnectTimer;
  // Each connection belongs to a generation. stop() and every new connection
  // move to the next one, so events from an obsolete socket (a late close
  // after a restart, its heartbeat) can't reconnect or touch the current one.
  let generation = 0;

  let reconnectAttempts = 0;

  const setupWebSocketClient = ({ status, success, reject }) => {
    const current = ++generation;
    const isCurrent = () => current === generation;
    let isAlive;
    let heartbeat;

    if (username && password) {
      options.headers = options.headers || {};
      options.headers.authorization = `Basic ${Buffer.from(
        `${username}:${password}`
      ).toString('base64')}`;
    }

    const socket = new WebSocket(address, [], options);
    client = socket;
    status(null, `Waiting for connection to ${address}`);

    socket.on('open', () => {
      if (!isCurrent()) {
        return;
      }
      isAlive = true;
      reconnectAttempts = 0;
      status(null, `Listening to ${address}`);

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
      if (!isCurrent() || (sample !== 1 && Math.random() > sample)) {
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
      status(null, 'Websocket connection has been closed');
      if (reconnectOnClose) {
        reconnectAttempts++;
        const delay = Math.min(
          10 * 1000 * Math.pow(2, reconnectAttempts - 1),
          5 * 60 * 1000
        );
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

  const setupWebSocketServer = ({ status, success, reject }) => {
    wsServer.ws(path, (ws) => {
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
      } catch (err) {
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
