# Global Configuration

The constants configuration is done with the help of the [rc](https://www.npmjs.com/package/rc) node module.

Our recommended way to configure the constants is to add a `.hyperwatchrc` at the root of your project folder.

This file can be in either `JSON` (recommended) or `ini` format.

Here is an example of how this file can look like:

```JSON
{
  "port": 4000,
  "modules": {
    "logs": { "active": true },
    "agent": { "active": true },
    "address": { "active": true }
  },
  "persistence": { "enabled": true }
}
```

This example would serve the app on port 4000, enable the live log streams, User-Agent parsing and the addresses aggregator, and keep aggregated data between restarts.

Values are merged with the defaults, so you only need to list what you change.

Constants can also be passed from a configuration file, as an argument of `hyperwatch.init()`:

```javascript
module.exports = function (hyperwatch) {
  hyperwatch.init({ modules: { logs: { active: true } } });
  // ...
};
```

You can find below the list of all configurable constants:

## Global

| Constant name     | Type    | Default | Description                                            |
| ----------------- | ------- | ------- | ------------------------------------------------------ |
| port              | integer | `3000`  | The port the app is running on                         |
| heartbeatInterval | integer | `30000` | Interval in ms between WebSocket pings sent to clients |

The `PORT` environment variable takes precedence over the `port` constant.

## Modules

Modules enrich logs and expose API endpoints. Each module is configured under `modules.<name>` with:

| Attribute | Type    | Description                                                  |
| --------- | ------- | ------------------------------------------------------------ |
| active    | boolean | Whether the module is loaded                                 |
| priority  | integer | Modules are loaded in ascending priority. Keep the defaults. |

Only `status` is active by default.

| Module     | Description                                                                                                                       | Endpoints              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| status     | Status of inputs and pipeline nodes                                                                                               | `/status`              |
| logs       | Streams every pipeline node over HTTP and WebSocket                                                                               | `/logs/<node>`         |
| cloudflare | Uses Cloudflare headers (`cf-connecting-ip`, `cf-ipcountry`, `cf-ray`) for the client address and data                            | –                      |
| geoip      | Geolocates addresses                                                                                                              | –                      |
| agent      | Parses User-Agents with [@hyperwatch/useragent](https://github.com/hyperwatch/useragent)                                          | –                      |
| hostname   | Reverse DNS lookup and forward verification of client addresses                                                                   | –                      |
| language   | Parses the `Accept-Language` header                                                                                               | –                      |
| dnsbl      | Checks client addresses against DNS blocklists                                                                                    | –                      |
| address    | Aggregates traffic per address                                                                                                    | `/addresses`           |
| signature  | Aggregates traffic per request signature                                                                                          | `/signatures`          |
| identity   | Identifies known robots and crawlers. Depends on `agent`, `hostname`, `signature` and `address`                                   | `/identities`          |
| history    | Keeps the latest logs of each pipeline node in memory (`capacity`, default `1000`), saved and restored when `persistence.enabled` | `/history/<node>.json` |
| sparkline  | Adds activity sparklines to aggregator HTML tables                                                                                | –                      |

Aggregator endpoints render an HTML table by default, or JSON and CSV with a `.json` or `.csv` extension. They accept `limit` (default `100`) and `sort` (default `count15m`) query parameters. A single entry is available at `/<aggregator>/<id>.json`, and `DELETE /<aggregator>` resets it.

To use a custom DNS server for the `hostname` module, set the `HYPERWATCH_DNS_SERVER` environment variable.

## Persistence

Aggregated data can be saved when Hyperwatch stops and loaded when it starts.

| Constant name         | Type    | Default            | Description                                      |
| --------------------- | ------- | ------------------ | ------------------------------------------------ |
| persistence.enabled   | boolean | `false`            | Whether to save and load aggregator data         |
| persistence.path      | string  | `.hyperwatch-data` | Directory for the data, relative to the cwd      |
| persistence.namespace | string  | `null`             | Optional sub-directory, to run several instances |
