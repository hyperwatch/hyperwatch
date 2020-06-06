const express = require('express');
const expressWs = require('express-ws');
const uuid = require('uuid');

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

  app.ws(endpoint, (client) => {
    const clientId = uuid.v4();
    clients[clientId] = client;
    updateMonitoringStatus();
    client.on('close', () => {
      delete clients[clientId];
      updateMonitoringStatus();
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
};

module.exports = app;
