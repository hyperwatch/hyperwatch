# Express embedding

Hyperwatch can run inside an existing Express 5 application, instead of running as a separate server. The app logs its own traffic and exposes the Hyperwatch API and live streams (HTTP and WebSocket) on its own port, under a path you choose.

```javascript
const http = require('node:http');
const express = require('express');
const basicAuth = require('express-basic-auth');
const hyperwatch = require('@hyperwatch/hyperwatch');

const {
  PORT = 3000,
  HYPERWATCH_USERNAME = 'hyperwatch',
  HYPERWATCH_SECRET,
} = process.env;

const app = express();
const server = http.createServer(app);

hyperwatch.init({ modules: { logs: { active: true } } });

// Log every request: register the input before other middleware and routes
const input = hyperwatch.input.express.create();
app.use(input.middleware());
hyperwatch.pipeline.registerInput(input);

// Mount the Hyperwatch API and live streams, behind authentication
const auth = basicAuth({ users: { [HYPERWATCH_USERNAME]: HYPERWATCH_SECRET } });

hyperwatch.app.mount(app, {
  server,
  path: '/_hyperwatch',
  middleware: auth,
});

// Other middleware and application routes

hyperwatch.modules.start();
hyperwatch.pipeline.start();
server.listen(PORT);
```

Don't call `hyperwatch.start()`: it would start the standalone Hyperwatch server.

## `hyperwatch.app.mount(app, options)`

| Option       | Required | Description                                                                                                      |
| ------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `server`     | yes      | The Node HTTP server of the app. `mount()` adds an `upgrade` listener to it, and never creates or starts one.    |
| `path`       | yes      | The mount path, e.g. `'/_hyperwatch'`. It must start with `/` and not end with `/`.                              |
| `middleware` | no       | A middleware function or an array of them, e.g. authentication. Applied to HTTP requests and WebSocket upgrades. |
| `fallback`   | no       | `(req, socket, head) => {}`, called with the WebSocket upgrades Hyperwatch doesn't own.                          |

### HTTP routes

`mount()` calls `app.use(path, ...middleware, router)`, at the point where it's called. The app's middleware order is kept:

- Middleware registered before `mount()` runs for Hyperwatch requests too. Mount Hyperwatch before a rate limiter if the watcher shouldn't be limited.
- Routes registered before `mount()` can answer first: mount Hyperwatch before a catch-all route (e.g. a Next.js request handler).

### WebSocket upgrades

`mount()` adds one `upgrade` listener to `server`:

- An upgrade with a malformed target (not an origin-form `/path?query`, e.g. `//[/` or an absolute URL) gets `400 Bad Request`, before reaching the app or `fallback`.
- An upgrade under the mount path (`/_hyperwatch` or `/_hyperwatch/…`) is sent through `app`, like an HTTP request. It goes through the same middleware, so authentication protects it, and Express answers errors as usual: a middleware can reject it with `401`, `next(error)` keeps the error's status, and an unknown Hyperwatch route gets `404`.
- Any other upgrade is passed to `fallback(req, socket, head)` when given. Otherwise it's left to the server's other `upgrade` listeners.

Hyperwatch only owns its mount path: `/other/logs/raw` is never handled by Hyperwatch, even though `/logs/raw` is a Hyperwatch route. The mount path is matched like Express matches `app.use()`: case-insensitively by default, and case-sensitively when the app enables `case sensitive routing`. So an HTTP request and a WebSocket upgrade to the same path always reach the same place.

`mount()` doesn't stop the server's other `upgrade` listeners from receiving Hyperwatch upgrades. A listener that closes the sockets of upgrades it doesn't serve would close the Hyperwatch WebSocket. Give such a component its own channel, and pass it the other upgrades with `fallback`, as below for Next.js.

### Mounting twice, and cleanup

`mount()` throws, before registering anything, when:

- Hyperwatch is already mounted on the same `server`.
- Hyperwatch was already mounted on the same app at the same path, matched like the app routes it (so `/_HYPERWATCH` is the same path by default). This holds even after `detachUpgrades()`: Express can't remove routes, so the first mount keeps answering at that path, with its original middleware. Mounting again couldn't change them, e.g. add authentication.

`mount()` returns `{ path, detachUpgrades }`. `detachUpgrades()` removes the `upgrade` listener, so Hyperwatch stops handling WebSocket upgrades, and releases the server for a mount at another path. It can be called several times. It doesn't unmount the HTTP routes, which stay mounted with their middleware.

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

hyperwatch.app.mount(app, {
  server,
  path: '/_hyperwatch',
  middleware: auth,
  fallback: (req, socket, head) =>
    nextUpgrades.emit('upgrade', req, socket, head),
});

// Next.js renders the pages, after Hyperwatch
app.use((req, res) => handle(req, res));
```

This is a version-specific workaround, not a stable integration contract. Next.js documents `httpServer` as the HTTP server it runs behind, and doesn't offer a way to keep its upgrade listener off a custom server. In Next.js 16.3, `httpServer` is only used to listen for `upgrade` events, so an `EventEmitter` works: verified with Next.js 16.3.4 in development (hot reload) and production, with a catch-all page. Check it again when upgrading Next.js.

## Subscribing to the live logs

A watcher can subscribe to the logs with a WebSocket input:

```javascript
const { HYPERWATCH_USERNAME = 'hyperwatch', HYPERWATCH_SECRET } = process.env;

input.websocket.create({
  type: 'client',
  address: 'wss://example.org/_hyperwatch/logs/raw',
  username: HYPERWATCH_USERNAME,
  password: HYPERWATCH_SECRET,
  reconnectOnClose: true,
});
```

## Upgrading from express-ws

With Hyperwatch 4.3 and Express 4, an app would call `expressWs(app)` and mount `hyperwatch.app.api` and `hyperwatch.app.websocket` itself. Express 5 is not compatible with express-ws, and Hyperwatch no longer uses it.

`hyperwatch.app.websocket` is still an Express middleware, so `app.use(path, hyperwatch.app.websocket)` doesn't throw, but on its own it doesn't handle any upgrade. Replace the express-ws setup and the `app.use()` calls with `hyperwatch.app.mount()`.
