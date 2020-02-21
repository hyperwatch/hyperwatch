## Monitor web traffic with Node/Express middleware integration

In this tutorial, we'll start analysing the web traffic on a Node/Express application using Hyper Watch.

We'll use the Websocket protocol that is one of the many protocol available with the Hyper Watch Express Logger middleware.

Let's start!

### Install Hyper Watch

On the same server where the Node/Express application is running, or on a server that is reachable by it, install the Hyper Watch processor.

As a prerequirement, you'll need Node.js &gt;= 7. Use nvm if you're in trouble.

```bash
nvm install node
```

During the beta phase, let's use Git and clone the public repository:

```bash
git clone https://github.com/znarf/hyper-watch.git
cd hyper-watch
npm install
```

### Configure Hyper Watch

In our suggested configuration, Hyper Watch will be listening for access logs using the Websocket protocol.

All communications between your Node/Express application and Hyper Watch will be happening in clear, so please only use that setup in your internal network. If on the public internet, we're advising to use the Websocket Secure protocol (wss) which is straightforward but out of the scope of this tutorial.

Now, you can create your own configuration in `./config/config.js`:

```javascript
const hyperWatch = require('../hyper-watch')();

const { pipeline, input } = hyperWatch;

const webSocketServerInput = input.websocket.create({
  name: 'WebSocket server (JSON standard format)',
  type: 'server',
  path: '/input/log',
});

pipeline.registerInput(webSocketServerInput);
```

### Configure Node/Express

Now, install the Hyper Watch Express Logger middleware in your Node application:

```bash
npm install --save access-watch-express-logger
```

Then simply configure it like any other middlewares:

```javascript
const express = require('express');
const accessWatchExpressLogger = require('access-watch-express-logger');

const app = express();

app.use(accessWatchExpressLogger('websocket', 'ws://localhost:3000/input/log'));
```

In this example, there are 3 important things:

1. If Hyper Watch is running on the same server, we can use `localhost` as IP address.
   If it's on a different server, replace `localhost` by the proper private or public IP address.
2. Replace the port (here `3000`) by the relevant one, it should be the main port where Hyper Watch is running.
3. Finally, the path `/input/log` should match the one configured on Hyper Watch side, If you're following this tutorial from start to begin, nothing to change!

Now, that you added and configured the Hyper Watch middleware, you can deploy and restart your application.

Note: The Hyper Watch middleware is also capable of logging using the HTTP(s) or the Syslog protocol. If you have any trouble with Websocket, you might want to try these one.

### Start Hyper Watch

Ok, now go back to where Hyper Watch is installed and start it.

```bash
npm start config/config.js
```

### Browse the interface

Now, you can point your browser to the IP/port where Hyper Watch is running. If you see data flowing, congrats you made it!
