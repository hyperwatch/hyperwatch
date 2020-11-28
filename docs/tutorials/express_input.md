## Monitor web traffic with Node/Express middleware integration

In this tutorial, we'll start analysing the web traffic on a Node/Express application using Hyperwatch.

We'll use the Websocket protocol that is one of the many protocol available with the Hyperwatch Express Logger middleware.

Let's start!

### Install Hyperwatch

On the same server where the Node/Express application is running, or on a server that is reachable by it, install the Hyperwatch processor.

As a prerequirement, you'll need Node.js &gt;= 7. Use nvm if you're in trouble.

```bash
nvm install node
```

During the beta phase, let's use Git and clone the public repository:

```bash
git clone https://github.com/hyperwatch/hyperwatch.git
cd hyperwatch
npm install
```

### Configure Hyperwatch

In our suggested configuration, Hyperwatch will be listening for access logs using the Websocket protocol.

All communications between your Node/Express application and Hyperwatch will be happening in clear, so please only use that setup in your internal network. If on the public internet, we're advising to use the Websocket Secure protocol (wss) which is straightforward but out of the scope of this tutorial.

Now, you can create your own configuration in `./config/config.js`:

```javascript
const hyperWatch = require('../hyperwatch');

const { pipeline, input } = hyperWatch;

const webSocketServerInput = input.websocket.create({
  name: 'WebSocket server (JSON standard format)',
  type: 'server',
  path: '/input/log',
});

pipeline.registerInput(webSocketServerInput);
```

### Configure Node/Express

Now, install the Hyperwatch Express Logger middleware in your Node application:

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

1. If Hyperwatch is running on the same server, we can use `localhost` as IP address.
   If it's on a different server, replace `localhost` by the proper private or public IP address.
2. Replace the port (here `3000`) by the relevant one, it should be the main port where Hyperwatch is running.
3. Finally, the path `/input/log` should match the one configured on Hyperwatch side, If you're following this tutorial from start to begin, nothing to change!

Now, that you added and configured the Hyperwatch middleware, you can deploy and restart your application.

Note: The Hyperwatch middleware is also capable of logging using the HTTP(s) or the Syslog protocol. If you have any trouble with Websocket, you might want to try these one.

### Start Hyperwatch

Ok, now go back to where Hyperwatch is installed and start it.

```bash
npm start config/config.js
```

### Browse the interface

Now, you can point your browser to the IP/port where Hyperwatch is running. If you see data flowing, congrats you made it!
