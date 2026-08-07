const crypto = require('crypto');

const express = require('express');
const expressWs = require('express-ws');

const constants = require('../constants');
const monitoring = require('../lib/monitoring');

const app = express();
expressWs(app);

app.streamToWebsocket = (
  endpoint,
  stream,
  { name = `WebSocket: ${endpoint}`, monitoringEnabled = false } = {}
) => {
  const clients = {};
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

  app.ws(endpoint, (client, req) => {
    const clientId = req.query.clientId || crypto.randomUUID();
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
  });

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

module.exports = app;
