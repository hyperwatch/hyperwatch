const app = require('../apps/websocket');
const rawStream = require('../lib/pipeline');
const memoryIndex = require('../plugins/memory-logs');

app.streamToWebsocket('/logs/raw', rawStream);

const { stream: augmentedStream } = require('../pipeline/augmented');

app.streamToWebsocket('/logs/augmented', augmentedStream);

const { stream: dashboardStream } = require('../pipeline/dashboard');

app.streamToWebsocket('/logs', dashboardStream);

augmentedStream.map(memoryIndex.index);

app.get('/logs', (req, res) => {
  const { query } = req;
  memoryIndex.searchLogs(query).then(logs => res.send(logs));
});