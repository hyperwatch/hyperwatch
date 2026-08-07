const { fromJS } = require('immutable');
const WebSocket = require('ws');

const app = require('../app/websocket');

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

  let reconnectAttempts = 0;

  const setupWebSocketClient = ({ status, success, reject }) => {
    let isAlive;
    let keepAlive;

    if (username && password) {
      options.headers = options.headers || {};
      options.headers.authorization = `Basic ${Buffer.from(
        `${username}:${password}`
      ).toString('base64')}`;
    }

    client = new WebSocket(address, [], options);
    status(null, `Waiting for connection to ${address}`);

    client.on('open', () => {
      isAlive = true;
      reconnectAttempts = 0;
      status(null, `Listening to ${address}`);

      // Heartbeat: detect stale connections
      keepAlive = setInterval(() => {
        if (isAlive === false) {
          client.terminate();
          clearInterval(keepAlive);
        } else {
          try {
            client.ping();
          } catch (err) {
            status(err, 'Websocket error');
          }
          isAlive = false;
        }
      }, heartbeatInterval);
    });

    client.on('message', (message) => {
      if (sample !== 1 && Math.random() > sample) {
        return;
      }
      try {
        success(parse(message));
      } catch (err) {
        reject(err);
      }
    });

    client.on('error', (err) => {
      status(err, 'Websocket error');
    });

    client.on('pong', () => {
      isAlive = true;
    });

    client.on('close', () => {
      status(null, 'Websocket connection has been closed');
      if (keepAlive) {
        clearInterval(keepAlive);
      }
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
        setTimeout(() => {
          setupWebSocketClient({ status, success, reject });
        }, delay);
      }
    });
  };

  const setupWebSocketServer = ({ status, success, reject }) => {
    app.ws(path, (ws) => {
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
      if (type === 'client') {
        setupWebSocketClient({ status, success, reject });
      } else if (type === 'server') {
        setupWebSocketServer({ status, success, reject });
      } else {
        const errMsg = 'WebSocket type is either client or server';
        log(new Error(errMsg), 'error');
      }
    },
    stop: () => {
      if (client) {
        client.close();
      }
    },
  };
}

module.exports = {
  create: create,
};
