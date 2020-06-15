const { fromJS } = require('immutable');
const WebSocket = require('ws');

const app = require('../app/websocket');

const defaultParse = (s) => fromJS(JSON.parse(s));

function create({
  name = 'WebSocket',
  address,
  path,
  options,
  type = 'client',
  parse = defaultParse,
  sample = 1,
  reconnectOnClose = false,
}) {
  let client;

  const setupWebSocketClient = ({ status, success, reject }) => {
    let isAlive;

    client = new WebSocket(address, [], options);
    status(null, `Waiting for connection to ${address}`);

    client.on('open', () => {
      isAlive = true;
      status(null, `Listening to ${address}`);
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

    const keepAlive = setInterval(() => {
      if (isAlive === false) {
        client.terminate();
        clearInterval(keepAlive);
      } else {
        client.ping();
        isAlive = false;
      }
    }, 10 * 1000);

    client.on('pong', () => {
      isAlive = true;
    });

    client.on('close', () => {
      status(null, 'Websocket connection has been closed');
      if (reconnectOnClose) {
        setTimeout(() => {
          status(null, 'Reconnecting Websocket');
          setupWebSocketClient({ status, success, reject });
        }, 10 * 1000);
      }
      clearInterval(keepAlive);
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
