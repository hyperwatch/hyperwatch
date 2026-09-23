# Embedding in an Express app

Hyperwatch can run inside an existing Express 5 application, instead of running as a separate server. The app logs its own traffic and exposes the Hyperwatch API and live streams (HTTP and WebSocket) on its own port, under a path you choose.

```javascript
const { createServer } = require('node:http');
const express = require('express');
const basicAuth = require('express-basic-auth');
const hyperwatch = require('@hyperwatch/hyperwatch');

const app = express();
const server = createServer(app);

hyperwatch.init({ modules: { logs: { active: true } } });

// Log every request: mount the input before other middlewares and routes
const input = hyperwatch.input.express.create();
app.use(input.middleware());
hyperwatch.pipeline.registerInput(input);

// Hyperwatch owns everything under /_hyperwatch, HTTP and WebSocket
const hw = hyperwatch.app.embed('/_hyperwatch');
const { HYPERWATCH_USERNAME = 'hyperwatch', HYPERWATCH_SECRET } = process.env;
const auth = basicAuth({ users: { [HYPERWATCH_USERNAME]: HYPERWATCH_SECRET } });
app.use(hw.path, auth, hw.router);
hw.attach(server, app);

// ... your middlewares and routes

hyperwatch.modules.start();
hyperwatch.pipeline.start();
server.listen(3000);
```

Don't call `hyperwatch.start()`: it would start the standalone Hyperwatch server.

## API

### `hyperwatch.app.embed(path)`

Declares the mount path, e.g. `'/_hyperwatch'`. It must start with `/` and not end with `/`. Returns:

| Property                       | Description                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `path`                         | The mount path                                                                            |
| `router`                       | The Hyperwatch routes, HTTP and WebSocket. Mount it with `app.use(hw.path, …, hw.router)` |
| `owns(req, { caseSensitive })` | Whether a request is under the mount path. Case-insensitive by default, like Express      |
| `attach(server, app, options)` | Handles the WebSocket upgrades of `server` under the mount path. Returns `detach()`       |

### `attach(server, app, { fallback })`

Adds one `upgrade` listener to `server`:

- An upgrade with a malformed target (not an origin-form `/path?query`, e.g. `//[/` or an absolute URL) gets `400 Bad Request`, before reaching the app or `fallback`.
- An upgrade under the mount path (`/_hyperwatch` or `/_hyperwatch/…`) is sent through `app`, like an HTTP request. It goes through the app's middlewares, so the authentication middleware protects it, and Express answers errors as usual: a middleware can reject it with `401`, `next(error)` keeps the error's status, and an unknown Hyperwatch route gets `404`.
- Any other upgrade is passed to `fallback(req, socket, head)` when given. Otherwise it's left to the server's other `upgrade` listeners.

Hyperwatch only owns its mount path: `/other/logs/raw` is never handled by Hyperwatch, even though `/logs/raw` is a Hyperwatch route.

The mount path is matched like Express matches `app.use()`: case-insensitively by default, and case-sensitively when the app enables `case sensitive routing`. So an HTTP request and a WebSocket upgrade to the same path always reach the same place.

Attaching the same `embed()` to the same server twice throws. `detach()` removes the listener, can be called several times, and allows attaching again.

### Other `upgrade` listeners

`attach` doesn't stop the server's other `upgrade` listeners from receiving Hyperwatch upgrades. A listener that closes the sockets of upgrades it doesn't serve would close the Hyperwatch WebSocket. Give such a component its own channel, and pass it the other upgrades with `fallback`, as below for Next.js.

## Next.js custom server (workaround for Next.js 16.3)

Next.js registers an `upgrade` listener for its own WebSockets (e.g. hot reload in development) on the server it runs behind: the `httpServer` option, or the server of the first request it handles. It ends the socket of any upgrade whose path matches one of its routes, e.g. a catch-all page, which includes `/_hyperwatch/logs/raw`.

So Next.js gets its own upgrade channel, and Hyperwatch passes it the upgrades it doesn't own:

```javascript
const { EventEmitter } = require('node:events');
const next = require('next');

// Next.js listens for upgrades on this channel, not on the server
const nextUpgrades = new EventEmitter();
const nextApp = next({ dev, httpServer: nextUpgrades });
const handle = nextApp.getRequestHandler();

const hw = hyperwatch.app.embed('/_hyperwatch');
app.use(hw.path, auth, hw.router);
hw.attach(server, app, {
  fallback: (req, socket, head) =>
    nextUpgrades.emit('upgrade', req, socket, head),
});

app.use((req, res) => handle(req, res));
```

This is a version-specific workaround, not a stable integration contract. Next.js documents `httpServer` as the HTTP server it runs behind, and doesn't offer a way to keep its upgrade listener off a custom server. In Next.js 16.3, `httpServer` is only used to listen for `upgrade` events, so an `EventEmitter` works: verified with Next.js 16.3.4 in development (hot reload) and production, with a catch-all page. Check it again when upgrading Next.js.

## Subscribing to the live logs

A watcher can subscribe to the logs with a WebSocket input:

```javascript
input.websocket.create({
  type: 'client',
  address: 'wss://example.org/_hyperwatch/logs/raw',
  username: process.env.HYPERWATCH_USERNAME || 'hyperwatch',
  password: process.env.HYPERWATCH_SECRET,
  reconnectOnClose: true,
});
```

## Upgrading from express-ws

With Hyperwatch 4.3 and Express 4, an app would call `expressWs(app)` and mount `hyperwatch.app.websocket`. Express 5 is not compatible with express-ws, and Hyperwatch no longer uses it.

`hyperwatch.app.websocket` is still an Express middleware, so `app.use(path, hyperwatch.app.websocket)` doesn't throw, but on its own it doesn't handle any upgrade. Replace the express-ws setup with `embed()` and `attach()` as above.
