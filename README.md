[![NPM version](https://img.shields.io/npm/v/@hyperwatch/hyperwatch)](https://www.npmjs.com/package/@hyperwatch/hyperwatch) [![Build Status](https://github.com/hyperwatch/hyperwatch/workflows/CI/badge.svg)](https://github.com/hyperwatch/hyperwatch/actions?query=workflow%3ACI)

Hyperwatch is a flexible access log processor that helps operators analyze HTTP traffic reaching their infrastructure.

Hyperwatch is built on a real-time stream processor handling logs from inputs of any type:

- CDNs (Cloudfront, Cloudflare, Akamai, ...)
- Load Balancers (ELB)
- Reverse Proxies (Nginx, Haproxy, ...)
- Web Servers (Nginx, Apache, ...)
- Applications (Node, Ruby, PHP, ...)

## Install

Make sure you have Node.js version >= 24.

We recommend using [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`.

```bash
git clone https://github.com/hyperwatch/hyperwatch.git
cd hyperwatch
npm install
```

## Start

```bash
npm start
```

It's loading the default configuration, it's the same as:

```bash
npm start config/default
```

## Configure

The first thing you might want is configuring inputs to connect Hyperwatch to your traffic sources and convert it in the proper format.

In order to do this, you need to create a new configuration file such as `config/custom.js`.

See [Input Configuration](./docs/input.md) for the list of available input types and how to configure them.

Modules (live log streams, User-Agent parsing, GeoIP, aggregations, …) and a few constants are configured with a `.hyperwatchrc` file. Only the `status` module is active by default. To learn more, head to [Global Configuration](./docs/configuration.md).

### Start with custom configuration

```shell
npm start config/custom
```

The Hyperwatch API and WebSocket will be served from port `3000` by default. Open `http://localhost:3000/status` to check the status of your inputs.

You can change that using an environment variable:

```shell
PORT=80 npm start config/custom
```

## Tutorials

- [Monitor web traffic with syslog input from Apache](./docs/tutorials/apache_input.md)
- [Monitor web traffic with Node/Express middleware integration](./docs/tutorials/express_input.md)

## License

[Apache License, version 2](LICENSE)
