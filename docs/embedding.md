# Embedding in an Express app

Hyperwatch can run inside an existing Express application (Express 4 or 5), instead of running as a separate server. The app logs its own traffic, can use Hyperwatch's analysis (e.g. identities) in its middlewares, and exposes the Hyperwatch API and live streams on its own port.

```javascript
const express = require('express');
const hyperwatch = require('@hyperwatch/hyperwatch');

const app = express();

hyperwatch.init({
  modules: {
    logs: { active: true },
    agent: { active: true },
    hostname: { active: true },
    identity: { active: true },
  },
});

// Log every request: mount the input before other middlewares and routes
const expressInput = hyperwatch.input.express.create();
app.use(expressInput.middleware());
hyperwatch.pipeline.registerInput(expressInput);

// Expose the API and live streams (HTTP and WebSocket), behind authentication
app.use('/_hyperwatch', authenticate, hyperwatch.app.api);

// ... your middlewares and routes

const server = app.listen(3000);

// Route WebSocket upgrades through the app, so they reach /_hyperwatch
hyperwatch.app.attach(server, app);

hyperwatch.modules.start();
hyperwatch.pipeline.start();
```

Don't call `hyperwatch.start()`: it would start the standalone Hyperwatch server.

## WebSocket

`hyperwatch.app.attach(server, app)` routes the WebSocket upgrades of the HTTP server through the Express app. They go through its middlewares, so the authentication middleware protects them like any HTTP request, and they reach the WebSocket routes under the path where `hyperwatch.app.api` is mounted (e.g. `/_hyperwatch/logs/raw`).

Only upgrades for Hyperwatch WebSocket routes are handled. Others, such as a development server's hot reload, are left to their own listeners.

A watcher can then subscribe to the live logs with a WebSocket input:

```javascript
input.websocket.create({
  type: 'client',
  address: 'wss://example.org/_hyperwatch/logs/raw',
  username: 'hyperwatch',
  password: process.env.HYPERWATCH_SECRET,
  reconnectOnClose: true,
});
```

## Using Hyperwatch in middlewares

The input attaches `req.hyperwatch` to every request. `getAugmentedLog()` runs the active modules on the current request:

```javascript
app.use(async (req, res, next) => {
  const log = await req.hyperwatch.getAugmentedLog({ fast: true });
  req.identity = log.get('identity'); // e.g. "Googlebot", or undefined
  next();
});
```

With `fast: true`, modules skip slow lookups (e.g. DNS) and use what they already know.
