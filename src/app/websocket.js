const crypto = require('crypto');

const constants = require('../constants');
const monitoring = require('../lib/monitoring');

const wsServer = require('./ws-server');

/**
 * Express middleware completing the Hyperwatch WebSocket upgrades dispatched
 * by hyperwatch.app.mount(), which already includes it. Kept for apps that
 * mounted it explicitly: on its own, it doesn't handle any upgrade.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const websocket = (req, res, next) => wsServer.middleware(req, res, next);

/**
 * The client's ?clientId=, the same standalone and mounted: the last value
 * when repeated (Express's query parser gives an array, the standalone
 * server the last one), none unless it's a non-empty string (the extended
 * parser can give an object)
 * @param {Record<string, any>} query
 * @returns {string | null}
 */
function clientIdOf(query) {
  const value = Array.isArray(query.clientId)
    ? query.clientId[query.clientId.length - 1]
    : query.clientId;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Sends the logs of a stream to the WebSocket clients of `endpoint`, live.
 * @param {string} endpoint
 * @param {import('../lib/pipeline').Node} stream
 * @param {{ name?: string, monitoringEnabled?: boolean }} [options]
 */
websocket.streamToWebsocket = (
  endpoint,
  stream,
  { name = `WebSocket: ${endpoint}`, monitoringEnabled = false } = {}
) => {
  /** @type {Record<string, Client>} */
  const clients = {};
  /** @type {import('../lib/monitoring').MonitoringItem | undefined} */
  let monitor;
  if (monitoringEnabled) {
    monitor = monitoring.register({
      name,
      speeds: ['processed'],
      type: 'output',
    });
  }
  const updateMonitoringStatus = () => {
    if (monitor) {
      const clientsSize = Object.keys(clients).length;
      if (clientsSize) {
        monitor.status = `${clientsSize} client${
          clientsSize > 1 ? 's' : ''
        } listening on ${endpoint}`;
      } else {
        monitor.status = `Waiting for clients on ${endpoint}`;
      }
    }
  };
  updateMonitoringStatus();

  wsServer.ws(endpoint, (/** @type {Client} */ client, req) => {
    const clientId = clientIdOf(req.query || {}) || crypto.randomUUID();
    if (clients[clientId]) {
      console.log(`Client '${clientId}' is already connected. Terminating.`);
      client.terminate();
      return;
    }
    clients[clientId] = client;
    client.isAlive = true;
    updateMonitoringStatus();
    client.on('pong', () => {
      client.isAlive = true;
    });
    client.on('close', () => {
      console.log(`Client '${clientId}' closed.`);
      delete clients[clientId];
      updateMonitoringStatus();
    });
    client.on('error', (error) => {
      console.log(`Client '${clientId}' error.`);
      console.log(error);
    });
  });

  stream.map((log) => {
    Object.values(clients).forEach((client) => {
      if (client.readyState === 1 /* === WebSocket.OPEN */) {
        if (monitor) {
          monitor.hit();
        }
        client.send(JSON.stringify(log));
      }
    });
  }, `ws:${endpoint}`);

  // Heartbeat: detect and clean up stale connections
  setInterval(() => {
    Object.entries(clients).forEach(([clientId, client]) => {
      if (!client.isAlive) {
        console.log(`Client '${clientId}' stale. Terminating.`);
        client.terminate();
        delete clients[clientId];
        updateMonitoringStatus();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, constants.heartbeatInterval || 30000);
};

/**
 * A WebSocket client, marked alive when it answers the heartbeat
 * @typedef {import('./ws-server').WebSocketClient & { isAlive?: boolean }} Client
 */

module.exports = websocket;
