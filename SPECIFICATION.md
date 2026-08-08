# Hyperwatch Specification

**Version:** 4.2.0
**Description:** Open Source HTTP Traffic Manager
**License:** Apache-2.0

Hyperwatch is a real-time HTTP traffic analysis system. It ingests HTTP access logs from multiple sources, enriches them through a modular pipeline, aggregates traffic by various dimensions (IP address, identity, request signature), and exposes results via an HTTP/WebSocket dashboard.

---

## Table of Contents

1. [Core Concepts](#1-core-concepts)
2. [Log Schema](#2-log-schema)
3. [Pipeline System](#3-pipeline-system)
4. [Speed Tracking](#4-speed-tracking)
5. [Aggregator](#5-aggregator)
6. [Cache](#6-cache)
7. [Input Adapters](#7-input-adapters)
8. [Log Format Parsers](#8-log-format-parsers)
9. [Modules](#9-modules)
10. [Plugins](#10-plugins)
11. [Web Application](#11-web-application)
12. [Persistence](#12-persistence)
13. [Configuration](#13-configuration)
14. [Formatter System](#14-formatter-system)
15. [Monitoring](#15-monitoring)
16. [Lifecycle](#16-lifecycle)

---

## 1. Core Concepts

Hyperwatch processes HTTP access logs through a **pipeline** of stream transformers. Each log event flows through enrichment modules (which add metadata like geolocation, user-agent parsing, hostname resolution) and then into **aggregators** that group and count traffic by different keys.

The core data flow:

```
Input Sources -> Validation -> Pipeline (enrichment modules) -> Aggregators -> Web Dashboard
```

**Key abstractions:**

- **Event:** An immutable map with `time` (unix epoch seconds), `data` (the log), and optionally `key` (for grouping).
- **Stream:** A function that accepts an event. `(event) => void`.
- **Stream Transformer (xf):** A function `(stream) => stream` that wraps a stream, possibly transforming events.
- **Pipeline:** A tree of stream transformers, built with a fluent builder API.
- **Aggregator:** Collects statistics about traffic grouped by a key function (e.g., by IP, by identity, by signature).

---

## 2. Log Schema

Every log entering the pipeline must conform to this JSON Schema:

```json
{
  "type": "object",
  "required": ["request", "response"],
  "properties": {
    "request": {
      "type": "object",
      "required": ["time", "address", "method", "url", "headers"],
      "properties": {
        "time": { "type": "string", "format": "date-time" },
        "address": { "type": "string", "format": "ipv4 or ipv6" },
        "scheme": { "type": "string", "enum": ["http", "https"] },
        "method": { "type": "string" },
        "url": { "type": "string" },
        "captured_headers": { "type": "array" },
        "headers": { "type": "object" }
      }
    },
    "response": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "status": { "type": "integer" }
      }
    },
    "executionTime": {
      "type": "number",
      "description": "Request execution time in milliseconds"
    }
  }
}
```

Logs are validated against this schema using JSON Schema (AJV with format validation). Invalid logs are rejected at the pipeline entry point.

The log is represented as an **immutable data structure** throughout the pipeline. Modules enrich it by returning new immutable values with additional fields set.

### Enriched Fields (added by modules)

After enrichment, a log may contain:

| Field                  | Type    | Description                                                                  |
| ---------------------- | ------- | ---------------------------------------------------------------------------- |
| `address.value`        | string  | Resolved client IP (may differ from `request.address` after proxy detection) |
| `address.hostname`     | string  | Reverse DNS hostname                                                         |
| `address.country-code` | string  | ISO country code (from Cloudflare header)                                    |
| `hostname.value`       | string  | Reverse DNS result                                                           |
| `hostname.verified`    | boolean | Forward-confirmed reverse DNS                                                |
| `agent`                | object  | Parsed user-agent (`family`, `major`, `minor`, `os.family`, etc.)            |
| `geoip`                | object  | GeoIP lookup result (`country`, `city`, `ll`, etc.)                          |
| `language`             | array   | Parsed Accept-Language (array of `{code, region, quality}`)                  |
| `cloudflare`           | object  | Cloudflare-specific data (`data-center`)                                     |
| `dnsbl.xbl`            | boolean | Spamhaus XBL lookup result                                                   |
| `identity`             | string  | Identified entity name (e.g., "Googlebot", "ChatGPT")                        |
| `signature.id`         | string  | MD5 hash of normalized identity headers                                      |
| `signature.headers`    | object  | Normalized subset of request headers                                         |
| `fingerprint`          | object  | Bot detection result: `{score, flags, age}`                                  |
| `firewall`             | object  | Matched firewall rule: `{action, rule, reason, explicit}`                    |

---

## 3. Pipeline System

The pipeline is a tree of composable stream processors.

### Stream Primitives

#### `identity()`

Returns a pass-through transformer: `(stream) => stream`

#### `map(f)`

Applies `f` to each event's data. `f` receives the log (immutable map) and must return a log (or a Promise of a log).

```
map(f) = (stream) => (event) => stream(event.set('data', f(event.get('data'))))
```

#### `filter(pred)`

Only forwards events where `pred(data)` returns true.

#### `comp(xfes)`

Composes an array of transformers sequentially (applies right-to-left, so the first in the array is the outermost).

#### `multiplex(xfes)`

Fans out: each event is forwarded to all child transformers in parallel.

#### `by(f)`

Partitions: sets `event.key` to `f(data)`. Ignores events where `f` returns `undefined`.

### Pipeline Builder

The `Pipeline` class extends `Builder` and provides a fluent API:

```
pipeline.getNode('main')     // Get the current "main" processing node
  .map(fn)                   // Add a map transformer
  .registerNode('main')      // Re-register this as the new "main" node
```

**Builder methods:**

- `map(f, label?)` - Add a map step
- `filter(pred, label?)` - Add a filter step
- `split(pred, labels?)` - Split into two branches: `[true, false]`
- `by(f, label?)` - Partition by key function
- `registerNode(name, options?)` - Register this node by name in the pipeline's node registry

**Node tracking:**
Each Builder node tracks:

- `counter`: total events processed
- `rateWindow`: array of timestamps for last 10 seconds (for rate calculation)
- `name`, `op`, `module`, `fnName`, `_label`: metadata for the tree visualization

**Pipeline (singleton):**

- `nodes` registry: Named map of `{name: Builder}`. Starts with `raw` and `main` pointing to the root.
- `inputs`: Array of registered input sources.
- `monitors`: Array of monitoring items.
- `registerInput(input)`: Register an input source with monitoring.
- `start()`: Creates the stream tree, then starts all inputs. Each input receives callbacks: `success(log)`, `reject(reason)`, `status(err, msg)`.
- `stop()`: Stops all inputs.
- `getTree(node?)`: Returns a JSON tree representation with counters, rates, and metadata.

**Validation on input:**
When an input calls `success(log)`, the log is validated against the JSON Schema. Valid logs are wrapped into an event `Map({time, data: log})` and forwarded into the pipeline stream. Invalid logs increment the "rejected" counter.

**Module registration pattern:**
Modules attach to the pipeline by getting the current `main` node, adding a `map` transformer, and re-registering it as `main`:

```
pipeline.getNode('main').map(augment).registerNode('main')
```

This forms a sequential chain where each module's enrichment builds on previous modules.

---

## 4. Speed Tracking

The `Speed` class tracks event rates over fixed-size sliding windows.

### Constructor

```
new Speed(windowSize, size)
```

- `windowSize`: Duration of each bucket in seconds (e.g., 60 for per-minute, 3600 for per-hour)
- `size`: Number of buckets to keep (e.g., 15 for 15 minutes of per-minute data, 24 for 24 hours)

### Internal State

- `counters`: Map of `{bucketTimestamp: count}` - tracks hit counts
- `sums`: Map of `{bucketTimestamp: sum}` - tracks accumulated values (e.g., execution time)
- `started`: Earliest hit timestamp
- `latest`: Most recent hit timestamp

### Methods

#### `hit(time?, value?)`

Record an event. `time` defaults to now (unix seconds). Bucket index = `time - (time % windowSize)`. Increments counter for that bucket. If `value` is provided, also adds to the sum for that bucket. Runs garbage collection.

#### `gc()`

Removes buckets older than `size * windowSize` seconds.

#### `compute()`

Returns a list of counter values for each bucket, from most recent to oldest. Only includes buckets from `started` onwards. Returns empty list if no hits recorded.

#### `computeSum()`

Same as `compute()` but returns sum values instead of counts.

#### `toJSON() / fromJSON(data)`

Serialization for persistence.

### Standard Speed Configurations

Aggregators create these speeds per entry:

- `per_minute`: `Speed(60, 15)` - 15 one-minute windows = 15 minutes of data
- `per_hour`: `Speed(3600, 24)` - 24 one-hour windows = 24 hours of data
- `ok_per_minute` / `ok_per_hour`: Same windows, tracks 2xx responses
- `err_per_minute` / `err_per_hour`: Same windows, tracks 4xx responses

---

## 5. Aggregator

The `Aggregator` class groups logs by a key and maintains statistics per group.

### Constructor

Creates an aggregator with default identifier, enricher, formatter, and sorters. Runs garbage collection every 60 seconds.

### Key Properties

- `entries`: Immutable Map of `{id: entry}` where id = MD5 of identifier
- `identifier`: Function `(log) => string` that determines the grouping key
- `enricher`: Function `(entry, log) => entry` that updates aggregator entries with log data
- `formatter`: A `Formatter` instance for display
- `sorters`: Object of `{name: (entry) => number}` for sorting entries
- `gcSize`: Maximum entries before GC (default: 1000)

### processLog(log)

1. Compute `identifier = this.identifier(log)`
2. Compute `id = MD5(identifier)`
3. Extract `executionTime` from log (default 0 if not finite)
4. Extract `status` from `response.status`
5. If entry doesn't exist: create it with `id`, `identifier`, and fresh Speed instances (hitting them with current execution time)
6. If entry exists: hit the `per_minute` and `per_hour` speeds with execution time
7. If status is 2xx: hit `ok_per_minute` and `ok_per_hour`
8. If status is 4xx: hit `err_per_minute` and `err_per_hour`
9. Run `enricher(entry, log)` to update metadata fields

### Default Enricher

Copies these fields from log to entry (if changed): `address`, `identity`, `cloudflare`, `dnsbl`, `firewall`, `geoip`, `hostname`, `agent`, `language`, `signature`.

### Default Identifier

Returns `log.identity || log.address.value || log.request.address`

### getData({raw, sort, format, limit})

1. Sort entries using `sorters[sort]` (default: `count15m`)
2. Take top `limit` entries (default: 100)
3. If `raw`: return raw immutable entries
4. Otherwise: format each entry using the formatter

### Default Sorters

- `count15m`: Sum of per_minute counters
- `count24h`: Sum of per_hour counters
- `ok15m/ok24h`: Sum of ok counters
- `err15m/err24h`: Sum of error counters
- `latest`: Most recent hit timestamp
- `execTime15m/execTime24h`: Sum of execution time

### Garbage Collection (gc)

When entries exceed `gcSize`: for each sorter, keep the top `gcSize` entries. The union of all "top" sets is kept; everything else is discarded.

### Serialization (dump/load)

- `dump()`: Converts entries to plain objects with Speed instances serialized via `toJSON()`
- `load(data)`: Restores entries from serialized data, rebuilding Speed instances. Signature headers stay as plain objects. Addresses are converted to Sets.

---

## 6. Cache

An async key-value cache with pluggable backend. Default: LRU cache (max 1000 entries).

### API

- `has(key) -> Promise<boolean>`
- `get(key) -> Promise<value>`
- `set(key, value, ttlInSeconds?) -> Promise`
- `del(key) -> Promise`
- `clear() -> Promise`
- `setProvider(provider)` - Replace the cache backend

### Provider Interface

```
{
  has(key): Promise<boolean>,
  get(key): Promise<value>,
  set(key, value, ttlInSeconds): Promise,
  del(key): Promise,
  clear(): Promise
}
```

---

## 7. Input Adapters

Each input adapter is created with a factory function that returns an object with `name`, `start({success, reject, status, log})`, and optionally `stop()`.

The callbacks:

- `success(log)`: Submit a valid immutable log map
- `reject(reason)`: Report a parse/processing error
- `status(err, msg)`: Report status changes
- `log(err, severity)`: General logging

### Express Middleware Input

```
input.express.create({ name?, app? })
```

Captures HTTP requests/responses from an Express app. Creates a log from `req`/`res` on the `finish` event, including execution time. Also attaches `req.hyperwatch.getAugmentedLog({fast?})` for inline enrichment.

The log is created from Express req/res:

```json
{
  "request": {
    "time": "<ISO timestamp>",
    "address": "<req.ip>",
    "method": "<req.method>",
    "url": "<req.originalUrl || req.url>",
    "headers": "<req.headers>"
  },
  "response": {
    "status": "<res.statusCode>"
  }
}
```

### WebSocket Input

```
input.websocket.create({
  name?, address?, path?, username?, password?,
  options?, type, parse?, sample?, reconnectOnClose?, heartbeatInterval?
})
```

- `type: 'client'`: Connects to a remote WebSocket server. Supports basic auth, heartbeat (ping/pong), and exponential backoff reconnection (10s \* 2^attempts, max 5 minutes).
- `type: 'server'`: Listens on the Hyperwatch WebSocket server at `path`.
- `parse`: Function to convert message to immutable log (default: `JSON.parse` + `fromJS`)
- `sample`: Float 0-1. If not 1, randomly drops messages (for load shedding).

### HTTP Input

```
input.http.create({ name?, path, parse? })
```

Registers a POST endpoint at `path`. Accepts JSON body (single object or array). Responds immediately with "Ok", then processes asynchronously.

### File Input

```
input.file.create({ name?, path, parse? })
```

Tails a file using the `tail` library. Each new line is parsed and submitted.

### Socket Input

```
input.socket.create({ name?, protocol?, port, parse?, sample? })
```

Listens on TCP and/or UDP. Splits incoming data by newlines. Supports sampling.

### Syslog Input

```
input.syslog.create({ name?, protocol?, port?, parse?, sample? })
```

Same as socket but first passes through syslog parser to extract the message field.

---

## 8. Log Format Parsers

For parsing log files in standard formats.

### Apache Log Parser

```
format.apache.parser({ format })
```

Compiles an Apache log format string into a parser function. The format string uses Apache's `%h`, `%t`, `%r`, `%>s` directives and `%{Header}i` for request headers.

**Built-in formats:**

- `combined`: Standard Apache combined log
- `hyperwatch_combined`: Extended with more headers

**Parsing rules:**

- `%h` -> `request.address`
- `%t` -> `request.time` (parsed from CLF format with strptime `%d/%B/%Y:%H:%M:%S %z`)
- `%>s` -> `response.status` (integer)
- `%r` -> Merged into `request` as `{method, url, protocol}`
- `%{name}i` -> `request.headers[name.toLowerCase()]` (skipped if value is `-`)

### Nginx Log Parser

```
format.nginx.parser({ format? })
```

Same concept but for Nginx variable names (`$remote_addr`, `$time_local`, `$status`, `$request`, `$http_*`).

**Parsing rules:**

- `$remote_addr` -> `request.address`
- `$time_local` -> `request.time` (CLF format)
- `$time_iso8601` -> `request.time` (as-is)
- `$status` -> `response.status` (integer)
- `$request` -> Merged into `request` as `{method, url, protocol}`
- `$http_*` -> `request.headers[name]` (underscore to dash, skipped if `-`)

---

## 9. Modules

Modules are the enrichment and analysis plugins. Each has an `init()` and/or `start()` method. They are loaded in priority order.

### Module Priority & Dependencies

| Module      | Priority | Phase          | Dependencies                                               |
| ----------- | -------- | -------------- | ---------------------------------------------------------- |
| status      | 100      | Output         | none                                                       |
| logs        | 200      | Output         | none                                                       |
| cloudflare  | 500      | Enrichment     | none                                                       |
| geoip       | 500      | Enrichment     | none                                                       |
| agent       | 501      | Enrichment     | none                                                       |
| hostname    | 502      | Enrichment     | none                                                       |
| language    | 503      | Enrichment     | none                                                       |
| dnsbl       | 503      | Enrichment     | none                                                       |
| address     | 600      | Classification | none                                                       |
| signature   | 610      | Classification | none                                                       |
| identity    | 620      | Classification | agent, hostname, signature, address                        |
| fingerprint | 625      | Classification | agent, identity                                            |
| firewall    | 650      | Classification | all enrichment; injects into address/signature aggregators |
| history     | 700      | Output         | none                                                       |
| sparkline   | 800      | Output         | none                                                       |

All modules are **inactive by default** (except `status`). They are activated via configuration.

### 9.1 Status Module

**Phase:** Output (start only)
**Registers:** `GET /status(.:format)?`

Displays monitoring data (input throughput, module processing stats) in HTML table or JSON.

Supports query params: `?type=` to filter by monitor type, `?raw=true` for raw data.

### 9.2 Logs Module

**Phase:** Output (start only)

For each registered pipeline node, creates:

- `WebSocket /logs/{nodeName}` - streams formatted logs in real-time
- `HTTP GET /logs/{nodeName}` - streams formatted log lines as HTML (supports `?grep=` filter)

### 9.3 Agent Module (User-Agent Parsing)

**Phase:** Enrichment (init)
**Depends on:** `@hyperwatch/useragent` library

Parses the `User-Agent` header using a dedicated UA parser. Results are cached.

**Enriches log with:**

```
agent: { family, major, minor, patch, os: { family, major, ... }, device: { ... } }
```

**Adds to formatters:**

- `agent` column: Shows `Family/Major.Minor` or raw UA string
- `os` column: Shows OS family (Mac OS X -> "macOS")

### 9.4 Hostname Module (Reverse DNS)

**Phase:** Enrichment (init)
**Async:** Yes (DNS lookups)

Performs forward-confirmed reverse DNS (FCrDNS):

1. Reverse DNS lookup on IP
2. If result is valid (not `.ip6.arpa` / `.in-addr.arpa`), forward-resolve the hostname
3. If forward resolution matches the original IP, mark as `verified`

Results are cached. Supports `{fast: true}` mode (skip DNS, return null).

Configurable DNS server via `HYPERWATCH_DNS_SERVER` env var.

**Enriches log with:**

```
hostname.value: "crawl-66-249-66-1.googlebot.com"
hostname.verified: true
address.hostname: "crawl-66-249-66-1.googlebot.com"
```

### 9.5 GeoIP Module

**Phase:** Enrichment (init)
**Uses:** `geoip-lite` (MaxMind database)

**Enriches log with:**

```
geoip: { country, region, city, ll, range, ... }
```

**Adds to formatters:**

- `country` column: Country flag emoji + code (HTML) or just code (text)
- `city` column

### 9.6 Cloudflare Module

**Phase:** Enrichment (init)

Extracts Cloudflare-specific headers:

- `cf-connecting-ip` -> Overrides `address.value` (the real client IP behind Cloudflare)
- `cf-ipcountry` -> Sets `address.country-code`
- `cf-ray` -> Extracts data center code into `cloudflare.data-center`

### 9.7 Language Module

**Phase:** Enrichment (init)
**Uses:** `accept-language-parser`

Parses the `Accept-Language` header.

**Enriches log with:**

```
language: [{ code: "en", region: "US", quality: 1 }, ...]
```

**Adds to formatters:**

- `language` column: Primary language code + region

### 9.8 DNSBL Module

**Phase:** Enrichment (init)
**Async:** Yes (DNS lookup)
**Uses:** `dnsbl` library against `xbl.spamhaus.org`

**Enriches log with:**

```
dnsbl.xbl: true/false
```

**Adds to formatters:**

- `xbl` column: "x" if listed, empty otherwise

### 9.9 Address Module

**Phase:** Classification (init + start)

**Init:** Fills `address.value` from `request.address` if not already set (e.g., by cloudflare module).

**Start:** Creates an Aggregator grouped by IP address (`address.value`).

Custom enricher collects:

- All standard enrichment fields
- `signatures`: Set of unique signature IDs seen from this address
- `signatureCount` sorter and formatter column

**Registers:** `GET /addresses(.:format)?` (HTML/JSON/CSV)

### 9.10 Signature Module

**Phase:** Classification (init + start)

**Init: `augment(log)`**

Computes a request "signature" from a normalized subset of headers:

- Accept, Accept-Charset, Accept-Language, Dnt, From, User-Agent

Headers are normalized to title case keys, sorted, joined as `Key:Value;`, and MD5-hashed.

**Enriches log with:**

```
signature.id: "a1b2c3d4..."  (MD5 hash)
signature.headers: { Accept: "...", "User-Agent": "..." }
```

**Start:** Creates an Aggregator grouped by signature ID.

Custom enricher tracks:

- `signature`, `identity`, `agent` fields
- `firewall` status (latest match)
- `fingerprint` score
- `lastAddress`: most recent address
- `addresses`: Set of all unique addresses seen with this signature

Custom formatter shows: signature hash, identity, address count, addresses list, last address, headers, score, counts, execution times.

Custom sorters: `addressCount`, `score`, `ok*`, `err*`.

**Registers:** `GET /signatures(.:format)?`

### 9.11 Identity Module

**Phase:** Classification (init + start)
**Depends on:** agent, hostname, signature, address modules

**Init: `augment(log)`**

Identifies known bots/services by matching user-agent family + verification:

**Verification methods:**

1. **Hostname suffix:** Most bots are verified by reverse DNS. E.g., Googlebot must have hostname ending in `.googlebot.com`.
2. **CIDR range:** Some bots are verified by IP range. E.g., GitHub Camo verified by `140.82.112.0/20`.
3. **Hostname + CIDR:** Some use either. E.g., Twitter verified by `.twttr.com` OR `199.16.156.0/22`.
4. **Cloud hosting hostname:** Some bots run on AWS/GCE/Hetzner and are verified by the cloud provider's hostname pattern.
5. **IP list files:** OpenAI, Amazon bots use JSON files of CIDR ranges that can be updated via scripts.
6. **Hostname only (no agent match):** Fallback checks for hostnames like `.googlebot.com`, `.search.msn.com`.
7. **Signature only:** Some bots identified by their unique header signature hash.

The function returns `log.set('identity', '<name>')` if matched.

**Known identities include:** Googlebot, Google, Bing, Baidu, Yandex, DuckDuckGo, Apple, Facebook, Twitter/X, LinkedIn, Slack, Discord, OpenAI (GPTBot, ChatGPT, SearchBot), Claude, Perplexity, Amazon (multiple bots), Meta, and ~60+ more services.

**Start:** Creates an Aggregator grouped by identity (falls back to address if no identity).

**Registers:** `GET /identities(.:format)?`

### 9.12 Fingerprint Module

**Phase:** Classification (init + start)
**Depends on:** agent, identity

**Init: `augment(log)`**

Detects anomalous browser behavior to score bot likelihood. Only applies to requests claiming to be from a browser engine (Chromium, Firefox, WebKit).

**Engine classification:**

- Chromium: Chrome, Samsung Internet, Brave, Vivaldi, Opera 15+, Edge 79+, etc.
- Firefox: Firefox, Firefox Mobile, Firefox iOS
- WebKit: Safari, Mobile Safari

**Negative signals (flags, increase score):**

- `missing-accept`: No Accept header
- `accept-star`: Accept is just `*/*`
- `accept-mismatch`: Accept doesn't include `text/html` or `image/`
- `accept-engine-mismatch`: Accept contains tokens impossible for claimed engine (e.g., Firefox with `image/apng`)
- `accept-nonstandard`: Accept contains `text/plain`
- `accept-version-mismatch`: Chromium version claims features not yet available
- `missing-accept-language`: No Accept-Language header
- `bare-accept-language`: Single language tag with no q-values (non-webkit only)
- `language-wildcard`: `*` as a language tag
- `language-mismatch`: Q-value pattern doesn't match claimed engine
- `ancient-version`: Browser version >24 months old
- `old-version`: 12-24 months old
- `aging-version`: 6-12 months old
- `headless-combo`: Missing/broken accept + missing language together

**Positive signals (reduce score):**

- `has-client-hints`: `sec-ch-ua` header present (Chromium 89+)
- `has-sec-fetch`: `sec-fetch-dest: document` + `sec-fetch-mode: navigate`
- `has-upgrade-insecure`: `upgrade-insecure-requests: 1` on page navigation
- `has-session`: Cookie contains session indicators

**Score calculation:**

- Base: `min(flagCount * 0.2, 1.0)`
- Each positive signal: `-0.2` (min 0)

**Enriches log with:**

```
fingerprint: { score: 0.4, flags: ["old-version", "has-sec-fetch"], age: 18.5 }
```

Subrequests (JS/CSS/images/fonts by URL extension) skip Accept header checks.

**Version age estimation:**

- Chromium: anchor Chrome 145 ~ Feb 2026, ~4 weeks per major
- Firefox: anchor Firefox 148 ~ Feb 2026, ~4 weeks per major
- WebKit/Safari: anchor Safari 26 ~ Sep 2025, ~12 months per major
- Age in months = `(anchor - major) * releaseInterval`

**Start:** Creates an Aggregator grouped by signature ID.

**Registers:** `GET /fingerprint(.:format)?`

### 9.13 Firewall Module

**Phase:** Classification (init + start)
**Depends on:** All enrichment modules; references address and signature aggregators

**Init:**

1. Loads rules from `firewall.json` (path configurable via `constants.modules.firewall.path`)
2. Watches the file for changes (5-second polling interval), auto-reloads
3. Registers augment in pipeline

**Rule format (firewall.json):**

```json
{
  "rules": [
    {
      "id": "rule-name",
      "action": "block",
      "reason": "Human-readable reason",
      "cloudflare": { "id": "cf-rule-id" },
      "match": { ... }
    }
  ]
}
```

**Match conditions (all must match for a rule to apply):**

- `address`: Exact IP match
- `addresses`: IP in list
- `cidrs`: IP in any CIDR range
- `asns`: ASN number in list
- `identity`: Exact identity string
- `no_identity`: Must have no identity
- `signature`: Exact signature ID
- `signatures`: Signature ID in list
- `headers`: Exact header value matches
- `headers_contain`: Header value contains substring
- `cookie_contains`: Cookie header contains substring
- `missing_headers`: Listed headers must be absent
- `min_fingerprint_score`: Minimum fingerprint score threshold
- `user_agents`: Exact User-Agent string in list
- `ua_regex`: Regex match on User-Agent (compiled to RegExp)

Rules are evaluated in order; first match wins.

**Enriches log with:**

```
firewall: { action: "block", rule: "rule-id", reason: "...", explicit: true/false }
```

`explicit` is true when the match was by specific address/addresses.

**Start:** Creates an Aggregator grouped by rule ID. Also injects firewall columns into the address and signature aggregators.

**Registers:** `GET /firewall(.:format)?`

**Utility functions:**

- `getExplicitAction(address)`: Check if an address is explicitly targeted by a rule
- `getSignatureAction(signature)`: Check if a signature is targeted by a rule

### 9.14 History Module

**Phase:** Output (start only)

Maintains a circular buffer of recent logs per pipeline node.

**Config:** `constants.modules.history.capacity` (default: 1000)

For each pipeline node, stores logs in a `CircularBuffer` and registers:

- `GET /history/{nodeName}.json?identity=&signature=&address=&limit=`

The circular buffer is a fixed-size array with a write pointer that wraps around.

### 9.15 Sparkline Module

**Phase:** Output (init only)

Adds an `activity` column to the default aggregator formatter. Renders a client-side canvas sparkline chart showing per-minute activity over the last 15 minutes.

The sparkline is rendered as an inline `<canvas>` element with a `<script>` tag calling a `sparkline()` JavaScript function.

---

## 10. Plugins

### Proxy Plugin

Detects the real client IP behind reverse proxies using the `X-Forwarded-For` header and the `proxy-addr` library.

**Trusted proxy ranges:**

- Loopback, link-local, unique-local
- Cloudflare IPs (from `cloudflare-ips.json`)
- CloudFront IPs (from `cloudfront-ips.json`)
- Sucuri IPs (hardcoded CIDRs)
- Imperva IPs (hardcoded CIDRs)

```
detectAddress(remoteAddress, headers) -> Map({ value: resolvedIP })
```

---

## 11. Web Application

The app layer runs an Express HTTP server with WebSocket support (via `express-ws`).

### HTTP Server

Listens on `constants.port` (default: 3000) or `PORT` env var.

### API Endpoints

**Built-in:**

- `GET /nodes(.:format)?` - List pipeline nodes (HTML table, JSON array, or CSV). `?view=tree` for tree visualization (JSON or HTML).
- `GET /status(.:format)?` - Monitoring status (from status module)

**Per aggregator (registered via `api.registerAggregator(name, aggregator)`):**

- `GET /{name}(.:format)?` - Aggregated data. Query params: `sort`, `limit`, `raw`, format via extension (`.json`, `.csv`)
- `GET /{name}/{identifier}(.:format)?` - Single aggregator entry by ID
- `DELETE /{name}` - Reset aggregator (clears all entries)

**HTML responses** include:

- Dark theme stylesheet (monospace, dark background, colored spans)
- Sparkline JavaScript for canvas charts
- Data rendered as HTML tables

**CSV export** uses `csv-stringify`. Excludes `activity` column (sparklines).

**JSON responses** return data as-is.

### HTTP Streaming (streamToHttp)

Creates a long-lived HTTP response that streams formatted log lines as `<div>` elements. Supports `?grep=` query parameter for filtering. Uses reverse column-flex CSS so newest entries appear at top.

Each connected client is tracked by a random UUID. Monitoring shows client count.

### WebSocket Streaming (streamToWebsocket)

Creates WebSocket endpoints that broadcast JSON-serialized log data to all connected clients.

**Features:**

- Client deduplication by `?clientId=` query parameter
- Heartbeat: ping/pong every 30 seconds (configurable via `constants.heartbeatInterval`). Stale clients (no pong response) are terminated.
- Monitoring tracks connected client count

---

## 12. Persistence

Saves and restores aggregator state across restarts.

### API

- `register(name, aggregator)` - Register an aggregator for persistence
- `dump(dir)` - Serialize all registered aggregators to `{dir}/{name}.json`
- `load(dir)` - Deserialize aggregator data from JSON files

Aggregators are automatically registered when `api.registerAggregator()` is called.

### Storage

- Directory: `constants.persistence.path` (default: `{cwd}/.hyperwatch-data`)
- Namespace subdirectory: `constants.persistence.namespace` (optional)
- Each aggregator stored as a separate JSON file
- Dump happens on `stop()`, load happens on `start()`

---

## 13. Configuration

Configuration uses the `rc` module, which merges (in priority order):

1. Defaults (in code)
2. Config files (`~/.hyperwatchrc`, `.hyperwatchrc`, etc.)
3. Environment variables (`hyperwatch_port=4000`)
4. Command line arguments (`--port 4000`)

### Default Configuration

```javascript
{
  port: 3000,                    // HTTP server port
  heartbeatInterval: 30000,      // WebSocket heartbeat interval (ms)
  modules: {
    status:      { active: true,  priority: 100 },
    logs:        { active: false, priority: 200 },
    cloudflare:  { active: false, priority: 500 },
    geoip:       { active: false, priority: 500 },
    agent:       { active: false, priority: 501 },
    hostname:    { active: false, priority: 502 },
    language:    { active: false, priority: 503 },
    dnsbl:       { active: false, priority: 503 },
    address:     { active: false, priority: 600 },
    signature:   { active: false, priority: 610 },
    identity:    { active: false, priority: 620 },
    fingerprint: { active: false, priority: 625 },
    firewall:    { active: false, priority: 650 },
    history:     { active: false, priority: 700 },
    sparkline:   { active: false, priority: 800 },
  },
  persistence: {
    enabled: true,
    path: null,        // Default: {cwd}/.hyperwatch-data
    namespace: null,   // Optional subdirectory
  }
}
```

Module-specific config (passed under `modules.{name}`):

- `firewall.path`: Path to firewall.json
- `history.capacity`: Circular buffer size

---

## 14. Formatter System

The `Formatter` class renders log/aggregator entries as formatted objects.

### Format Definition

An array of `[key, fn]` pairs where `fn(entry, output) => string|value`.

`output` is one of: `'html'`, `'console'`, `'text'`, `'json'`.

### Color System

A map of `{key: colorName}`. In `html` output, values are wrapped in `<span class="{color}">`. In `console` output, chalk is used. In `text`/`json`, no coloring.

Available colors: `red`, `cyan`, `grey`, `yellow`, `orange`, `green`, `magenta`.

### Methods

- `setFormats(formats)` - Replace all format definitions
- `pickFormats(keys)` - Keep only named formats
- `replaceFormat(key, fn)` - Replace a format function by key
- `insertFormat(key, fn, {after?, before?, color?})` - Insert a format at a specific position
- `formatObject(entry, output?)` - Returns `{key: formattedValue}` object
- `format(entry, output?)` - Returns a single string (values joined by space, filtered for empty)

### Standard Log Formats (Logger Formatter)

- `time`: Request time (HH:MM:SS)
- `identity`: Identity string
- `address`: Hostname (if available) with verified marker (`+`), else IP
- `request`: `"METHOD /url STATUS"`
- `executionTime`: Colored by duration (<100ms green, 100-999ms yellow, 1000ms+ red)
- `agent`: Raw User-Agent string

### Standard Aggregator Formats (Default Aggregator Formatter)

- `identity`
- `address`: Hostname or IP
- `count15m`, `count24h`: Sum of per-minute/per-hour hits
- `ok15m/ok24h`, `err15m/err24h`: Success/error counts
- `execTime15m/execTime24h`: Formatted duration (e.g., "2m30s", "1.5s")
- `lastSeen`: ISO timestamp of most recent hit

---

## 15. Monitoring

A global registry of monitoring items that track system health and throughput.

### MonitoringItem

```
{
  name: string,
  type: 'input' | 'output' | 'node',
  status: string,
  speeds: { [speedName]: { per_minute: Speed, per_hour: Speed } },
  hit(speedName?, value?),
  getComputed(): immutable map with speeds resolved to arrays
}
```

Inputs register monitors with speeds `['accepted', 'rejected']`.
Output streams register monitors with speed `['processed']`.
Pipeline nodes optionally register monitors with speed `['processed']`.

---

## 16. Lifecycle

### Library Usage

```javascript
const hyperwatch = require('@hyperwatch/hyperwatch');

// 1. Configure and initialize
hyperwatch.init({
  port: 3000,
  modules: {
    agent: { active: true },
    hostname: { active: true },
    geoip: { active: true },
    address: { active: true },
    signature: { active: true },
    identity: { active: true },
    logs: { active: true },
    status: { active: true },
  },
});

// 2. Register inputs
const wsInput = hyperwatch.input.websocket.create({
  name: 'WebSocket',
  type: 'server',
  path: '/input/log',
});
hyperwatch.pipeline.registerInput(wsInput);

// Or use Express middleware
const expressInput = hyperwatch.input.express.create({ name: 'Express' });
hyperwatch.pipeline.registerInput(expressInput);
yourApp.use(expressInput.middleware());

// 3. Add custom pipeline steps
hyperwatch.pipeline.getNode('main').map((log) => {
  console.log(log);
  return log;
});

// 4. Start
hyperwatch.start();

// 5. Graceful shutdown
process.on('SIGTERM', () => hyperwatch.stop());
```

### Init Phase

1. Merge user config with defaults (via `rc`)
2. For each active module (sorted by priority), call `module.init()` with `pipeline.currentModule` set
3. Init typically adds `map(augment)` steps to the pipeline

### Start Phase

1. For each active module (sorted by priority), call `module.start()`
2. Start typically creates Aggregators and registers API endpoints
3. If persistence enabled, load saved aggregator state from disk
4. Start the Express HTTP/WS server
5. Create the pipeline stream tree and start all inputs

### Stop Phase

1. If persistence enabled, dump all aggregator state to disk
2. Stop the HTTP server
3. Stop all input sources

---

## Appendix A: Utility Functions

- `now()`: Current time as unix seconds
- `complement(pred)`: Returns negated predicate
- `createLog(req, res)`: Creates immutable log from Express request/response
- `aggregateCount(entry, speedKey)`: Sum all counters in a speed
- `aggregateSum(entry, speedKey)`: Sum all sums in a speed
- `formatDuration(ms)`: Human-readable duration ("2m30s", "1.5s")
- `formatTable(data)`: Render array of objects as HTML table
- `md5(string)`: MD5 hex digest

## Appendix B: Data Files

The following JSON data files are used for IP verification:

- `src/data/cloudflare-ips.json` - Cloudflare proxy IP ranges
- `src/data/cloudfront-ips.json` - CloudFront proxy IP ranges
- `src/data/gptbot-ips.json` - OpenAI GPTBot CIDR ranges
- `src/data/chatgpt-user-ips.json` - ChatGPT user CIDR ranges
- `src/data/openai-searchbot-ips.json` - OpenAI SearchBot CIDR ranges
- `src/data/amazonbot-ips.json` - Amazonbot CIDR ranges
- `src/data/amazon-searchbot-ips.json` - Amazon SearchBot CIDR ranges
- `src/data/amazon-user-ips.json` - Amazon User CIDR ranges

These are periodically updated via scripts.

## Appendix C: External Dependencies

| Package                  | Purpose                                                   |
| ------------------------ | --------------------------------------------------------- |
| `@hyperwatch/useragent`  | User-agent string parsing                                 |
| `accept-language-parser` | Accept-Language header parsing                            |
| `ajv` + `ajv-formats`    | JSON Schema validation                                    |
| `chalk`                  | Terminal color output                                     |
| `country-code-emoji`     | Country code to flag emoji                                |
| `csv-stringify`          | CSV export                                                |
| `dnsbl`                  | DNS blacklist lookups                                     |
| `express` + `express-ws` | HTTP server + WebSocket                                   |
| `geoip-lite`             | MaxMind GeoIP lookups                                     |
| `immutable`              | Immutable data structures (Map, List, Set, Range, fromJS) |
| `ip-cidr`                | CIDR range matching                                       |
| `lodash`                 | `merge` for deep config merging                           |
| `lru-cache`              | Default cache backend                                     |
| `micro-strptime`         | CLF date parsing                                          |
| `proxy-addr`             | X-Forwarded-For parsing with trusted proxy support        |
| `rc`                     | Configuration file/env/CLI merging                        |
| `syslog-parse`           | Syslog message parsing                                    |
| `tail`                   | File tailing                                              |
| `ws`                     | WebSocket client                                          |
