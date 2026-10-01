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

| Module     | Description                                                                                                                                               | Endpoints               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| status     | Status of inputs and pipeline nodes                                                                                                                       | `/`, `/status`          |
| logs       | Streams every pipeline node over HTTP and WebSocket                                                                                                       | `/logs`, `/logs/<node>` |
| cloudflare | Uses Cloudflare headers (`cf-connecting-ip`, `cf-ipcountry`, `cf-ray`) for the client address and data                                                    | –                       |
| geoip      | Geolocates addresses                                                                                                                                      | –                       |
| agent      | Parses User-Agents with [@hyperwatch/useragent](https://github.com/hyperwatch/useragent)                                                                  | –                       |
| hostname   | Reverse DNS lookup and forward verification of client addresses                                                                                           | –                       |
| language   | Parses the `Accept-Language` header                                                                                                                       | –                       |
| dnsbl      | Checks client addresses against DNS blocklists                                                                                                            | –                       |
| address    | Aggregates traffic per address                                                                                                                            | `/addresses`            |
| signature  | Aggregates traffic per request signature                                                                                                                  | `/signatures`           |
| identity   | Identifies known robots and crawlers. Depends on `agent`, `hostname`, `signature` and `address`                                                           | `/identities`           |
| history    | Keeps the latest logs of each pipeline node in memory (`capacity`, default `100`, and per node, see below), saved and restored when `persistence.enabled` | `/history/<node>.json`  |

Aggregator endpoints render an HTML table by default, or JSON and CSV with a `.json` or `.csv` extension. They accept `limit` (default `100`) and `sort` (default `count15m`) query parameters. In the HTML table, the headings of sortable columns link to the table sorted by them, and only the columns of the last 15 minutes are shown, or of the last 24 hours with `?period=24h` (which also sorts by `count24h` by default). `/addresses` and `/identities` also accept `filter=identified` or `filter=unidentified`, to keep only the entries with or without an identity (before `limit`), with links to switch in the HTML table. A single entry is available at `/<aggregator>/<id>.json`, and `DELETE /<aggregator>` resets it.

The HTTP log streams (`/logs/<node>`, `/logs` opens `main`) link to the nodes above and one level below them in the pipeline, show the latest lines at the bottom, keep the logs of one `?address=`, `?identity=` or `?signature=` (exact matches, like `/history/<node>.json`; an identity without a name is matched by its address), and lines including `?grep=`. On the addresses and identities pages, addresses and identities link to their logs. When `history` is active, they start with the latest `100` logs of the node: `?history=<n>` changes that number, `?history=0` only shows live logs. WebSocket streams only send live logs.

To use a custom DNS server for the `hostname` module, set the `HYPERWATCH_DNS_SERVER` environment variable.

### History per node

History is usually what uses the most memory: each node keeps its latest `capacity` logs. Nodes that see the same requests (e.g. `main`, `raw` and the `input-<n>` node of each input) keep them alive longer between them, and each one is a separate persistence document. `modules.history.nodes` sets the number of logs per node, `0` keeping none:

```json
{
  "modules": {
    "history": {
      "active": true,
      "capacity": 300,
      "nodes": { "main": 1000, "raw": 0, "input-*": 0 }
    }
  }
}
```

- An exact node name comes first; otherwise the first pattern ending with `*` that matches the name (`input-*` matches `input-1`, `input-2`…); otherwise `capacity`.
- A node with `0` has no buffer and no persistence document: `/history/<node>.json` answers `[]`, and its live logs start empty. Persistence never deletes documents: one saved before the node was set to `0` stays in storage, and is restored if the node is turned on again (like the document of a renamed or removed node, it's ignored meanwhile).
- Values may be strings (environment variables, through rc). An invalid value is reported, and `capacity` (or `100`) is used instead.

## Persistence

Aggregated data and the history of each node can be saved when Hyperwatch stops, and periodically, and loaded when it starts, before the inputs start.

| Constant name              | Type    | Default            | Description                                                                               |
| -------------------------- | ------- | ------------------ | ----------------------------------------------------------------------------------------- |
| persistence.enabled        | boolean | `false`            | Whether to save and load aggregator data                                                  |
| persistence.backend        | string  | `file`             | Where the data is kept: `file` or `s3` (below)                                            |
| persistence.path           | string  | `.hyperwatch-data` | Directory for the `file` backend, relative to the cwd                                     |
| persistence.namespace      | string  | `null`             | Sub-directory (files) or key prefix (S3), to run several instances                        |
| persistence.interval       | number  | `null`             | Seconds between periodic snapshots, off when `null`. Without it, a crash loses everything |
| persistence.deadlines.load | number  | `60`               | Seconds before restoring gives up at start                                                |
| persistence.deadlines.dump | number  | `60`               | Seconds before a periodic snapshot gives up                                               |
| persistence.deadlines.stop | number  | `20`               | Seconds for the final snapshot and closing the storage at stop                            |

Each registered aggregator and history buffer is one plain JSON document, not compressed: `<path>/<namespace>/<name>.json` with the `file` backend, `<prefix><namespace>/<name>.json` with `s3`.

- **Environment:** through rc, e.g. `hyperwatch_persistence__enabled=1` or `hyperwatch_persistence__interval=300`. `enabled` accepts `true`, `1`, `"true"` and `"1"`, anything else is off. Durations must be between 1 ms and about 24.8 days (the range of Node timers): an invalid `interval` turns snapshots off with a warning, an invalid deadline falls back to its default, and an unknown `backend` fails at `hyperwatch.init()`.
- **Failures:** missing or unreadable documents are skipped, and what was restored is kept. When a deadline passes, the phase gives up, logs it, and startup or shutdown carries on. Stopping while the data is still being restored waits for it within the stop deadline, and skips the final snapshot if it isn't done, so the stored one isn't overwritten.
- **One writer per namespace:** an instance writes complete snapshots and only reads them at start. Two instances on the same namespace (including the old and new processes during a rolling deployment) overwrite each other: give independent instances their own namespace.
- **Metrics:** every load and dump is logged, e.g. `Persistence (file) loaded 26 documents (213 MB) in 2.3s: fetch 0.27s, parse 0.52s, restore 1.5s`, and the latest ones are on `/status` (all the figures in `/status.json?raw=1`). Stage times are summed over the documents, the total is wall-clock time.

A custom storage can replace the backend with `hyperwatch.lib.persistence.setStorage(storage)`, before `hyperwatch.start()`. It has async `read(name, { signal })` (the document, or `null` when missing), `write(name, body, { signal })` and `close()`. An aborted write must not overwrite a newer snapshot: prevent it from committing, or reject further writes to that document when a remote commit cannot be ruled out. `test/lib/storage/contract.js` has the tests a storage should pass.

### S3

The `s3` backend keeps the documents in one S3 bucket (or an S3-compatible store). It needs `@aws-sdk/client-s3`, an optional peer dependency: `npm install @aws-sdk/client-s3`.

| Constant name                 | Type    | Default | Description                                                                                            |
| ----------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------ |
| persistence.s3.bucket         | string  | `null`  | The bucket, required                                                                                   |
| persistence.s3.prefix         | string  | `''`    | Optional key prefix, e.g. `watch/`, to share a bucket                                                  |
| persistence.s3.region         | string  | `null`  | The bucket's region (`AWS_REGION`, then `us-east-1`, when not set). A wrong one works after a redirect |
| persistence.s3.endpoint       | string  | `null`  | For S3-compatible stores (MinIO, Cloudflare R2…)                                                       |
| persistence.s3.forcePathStyle | boolean | `false` | Path-style URLs, which MinIO needs                                                                     |

```sh
hyperwatch_persistence__enabled=1
hyperwatch_persistence__backend=s3
hyperwatch_persistence__s3__bucket=my-hyperwatch-bucket
hyperwatch_persistence__s3__region=eu-west-1
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
```

- **Credentials** come from the AWS SDK's default chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, instance roles…), never from the Hyperwatch configuration.
- **Permissions:** `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::<bucket>/*` (or `<bucket>/<prefix>*`), and unconditional `s3:ListBucket` on `arn:aws:s3:::<bucket>`. Hyperwatch never lists the bucket, but without `ListBucket` S3 answers `403 AccessDenied` instead of `404 NoSuchKey` for a missing object, so every document of a new namespace would be counted as failed. A `StringLike` condition on `s3:prefix` doesn't fix this: it requires a prefix parameter on a listing request, which `GetObject` doesn't supply. Prefer one bucket and one user per environment, as in the policy below. For a shared bucket, restrict `GetObject` and `PutObject` to each environment's prefix; unconditional `ListBucket` still allows that user to list other environments' object keys. If that visibility is unacceptable, use separate buckets, or keep prefix-restricted listing permissions and accept that missing documents are reported as failed reads:

  ```json
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject", "s3:PutObject"],
        "Resource": "arn:aws:s3:::my-hyperwatch-bucket/*"
      },
      {
        "Effect": "Allow",
        "Action": "s3:ListBucket",
        "Resource": "arn:aws:s3:::my-hyperwatch-bucket"
      }
    ]
  }
  ```

- **Security:** the history holds client IPs, headers and URLs. Keep the bucket private ("Block all public access"), with default encryption. Errors only log the key and the S3 error.
- **Deadlines and upload failures:** a request is aborted when its phase's deadline passes. A write S3 has already fully received can still complete. After an upload abort, transport failure, timeout or server error, the backend rejects all further writes to that document for the lifetime of the storage, including the final shutdown snapshot. Other documents continue to be saved. This prevents an uncertain older upload from overwriting a newer snapshot. SDK retries are disabled for the same reason; a definitive rejection such as `403 AccessDenied` allows a later upload. Investigate the failed upload before restarting, and ensure the old remote request has finished before using the same namespace again; a restart alone cannot cancel it. Read errors don't disable uploads.
- **Size:** a busy instance dumps about 100–200 MB. The upload counts toward `deadlines.stop` at shutdown.
