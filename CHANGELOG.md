# Changelog

Releases are also on [GitHub](https://github.com/hyperwatch/hyperwatch/releases). Versions before 5.0.0 have no entry: see the git history.

## 5.3.2 (2026-10-09)

### Identities

- `CCBot` is identified as Common Crawl only from the ranges Common Crawl publishes (`src/data/ccbot-ips.json`, refreshed by `scripts/fetch-commoncrawl-ips.js`). It used to be identified from a `.compute-1.amazonaws.com` hostname, which any EC2 instance has, and its IPv6 crawlers weren't identified at all. ([#633](https://github.com/hyperwatch/hyperwatch/pull/633))
- `PerplexityBot` and `Perplexity-User` are identified as `Perplexity` only from the lists Perplexity publishes for each (`src/data/perplexitybot-ips.json`, `perplexity-user-ips.json`, refreshed by `scripts/fetch-perplexity-ips.js`). `PerplexityBot` used to be identified from an EC2 hostname, and `Perplexity-User` wasn't identified. ([#635](https://github.com/hyperwatch/hyperwatch/pull/635))
- Published ranges refreshed: new ranges for ChatGPT-User, ClaudeBot and Google's user-triggered fetchers. None removed. ([#636](https://github.com/hyperwatch/hyperwatch/pull/636))

### Dependencies & tooling

- `ip-cidr` replaced by `ip-address` 10, through a new `src/lib/cidr.js`. This removes the vulnerable `ip-address` 9 and `sprintf-js` 1.1.3 that `ip-cidr` pulled in ([#638](https://github.com/hyperwatch/hyperwatch/pull/638)). Range lists are now compiled once instead of on every request. An address never matches a range of the other family, and IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) are matched as IPv4. ([#639](https://github.com/hyperwatch/hyperwatch/pull/639))
- `@hyperwatch/useragent` updated to 4.0.1: Edge for iOS with `Version/` after the agent, and iOS apps with a `[Name]/version` suffix, are now parsed correctly. ([#640](https://github.com/hyperwatch/hyperwatch/pull/640))
- Dependency updates: `@aws-sdk/client-s3`, eslint, eslint-plugin-n, globals, mocha, source-map-js.

## 5.3.1 (2026-10-05)

### Identities

- `amazon-Quick-on-behalf-of-<id>` (Amazon Quick's Web Crawler) is identified as `Amazon Quick` when it comes from the ranges published in Amazon Quick's documentation, copied in `src/data/amazon-quick-ips.json`. ([#627](https://github.com/hyperwatch/hyperwatch/pull/627))

### Dependencies & tooling

- `@hyperwatch/useragent` updated to 4.0.0, with updated UAP Core regexes and generic rules (for example a name followed by a hex id, such as `amazon-Quick-on-behalf-of-<id>`). Its new Node.js >= 24 requirement matches Hyperwatch's. ([#627](https://github.com/hyperwatch/hyperwatch/pull/627))

## 5.3.0 (2026-10-02)

### Features

- New `firewall` module, inactive by default: IP and User-Agent lists (`block`, `challenge` or `monitor`) that tag matching logs, with an HTTP API to look up and edit them. Lists are stored in local files or on S3, can be declared in the configuration, and can be kept in sync with Cloudflare WAF custom rules automatically. See `docs/firewall.md`. ([#586](https://github.com/hyperwatch/hyperwatch/pull/586))

### Identities

- `github-camo` is identified as `GitHub Camo`, and is also verified from `9.234.0.0/17`, where it fetches from in production. ([#624](https://github.com/hyperwatch/hyperwatch/pull/624))
- Meta and Facebook crawlers are verified from the routes of Meta's network (AS32934) in RADb, fetched by `scripts/fetch-meta-ips.js`, instead of a single hard-coded range. `Hyperlink` is identified as Meta. ([#625](https://github.com/hyperwatch/hyperwatch/pull/625))
- Google's user-triggered fetchers ranges are available in `src/data/google-user-triggered-fetchers-ips.json`, refreshed by `scripts/fetch-google-ips.js`. Data only: Hyperwatch doesn't use them yet. ([#626](https://github.com/hyperwatch/hyperwatch/pull/626))

## 5.2.0 (2026-10-01)

### Breaking changes

- The `history` module keeps 100 logs per node by default instead of 1000. Set `modules.history.capacity` to keep more; configurations that already set it are unaffected ([#623](https://github.com/hyperwatch/hyperwatch/pull/623))
- `hyperwatch.start()` is now async: modules register, persistence restores, then the inputs and the app start. Await it, and handle its rejection, if you rely on the instance being started ([#619](https://github.com/hyperwatch/hyperwatch/pull/619))

### Features

- S3 persistence backend: `persistence.backend: 's3'` stores one JSON object per document in a bucket, configured with `persistence.s3.{bucket,prefix,region,endpoint,forcePathStyle}`, S3-compatible stores included. `@aws-sdk/client-s3` is an optional peer dependency, needed only when S3 is selected ([#620](https://github.com/hyperwatch/hyperwatch/pull/620))
- Pluggable persistence storage: backends implement `read`, `write` and `close`, and `persistence.setStorage()` replaces the default `file` backend, whose layout is unchanged ([#619](https://github.com/hyperwatch/hyperwatch/pull/619))
- Periodic snapshots with `persistence.interval` (seconds, off by default), and `persistence.deadlines` for `load`, `dump` and `stop` (60, 60 and 20 seconds), so a stalled storage doesn't hold a start or a stop ([#619](https://github.com/hyperwatch/hyperwatch/pull/619))
- Each persistence load and dump logs its documents, bytes and stage times, and the latest ones are on `/status` ([#619](https://github.com/hyperwatch/hyperwatch/pull/619))
- History capacity node by node: `modules.history.nodes` sets the number of logs per node, by exact name or with a `*` suffix pattern, and `0` keeps no history for a node ([#623](https://github.com/hyperwatch/hyperwatch/pull/623))

### Fixes

- `persistence.enabled` set to `false` through an environment variable no longer enables persistence: `true`, `1`, `"true"` and `"1"` are on, anything else is off ([#619](https://github.com/hyperwatch/hyperwatch/pull/619))
- Numeric settings for history and persistence accept numbers and decimal strings only: `true`, `''` or `[5]` are reported instead of being read as a number ([#623](https://github.com/hyperwatch/hyperwatch/pull/623))

### Dependencies & tooling

- Bumped ws, dnsbl, chalk, serialize-javascript, fast-uri, brace-expansion, eslint-plugin-n and lint-staged ([#611](https://github.com/hyperwatch/hyperwatch/pull/611), [#612](https://github.com/hyperwatch/hyperwatch/pull/612), [#613](https://github.com/hyperwatch/hyperwatch/pull/613), [#614](https://github.com/hyperwatch/hyperwatch/pull/614), [#616](https://github.com/hyperwatch/hyperwatch/pull/616), [#617](https://github.com/hyperwatch/hyperwatch/pull/617), [#621](https://github.com/hyperwatch/hyperwatch/pull/621), [#622](https://github.com/hyperwatch/hyperwatch/pull/622))
- CI runs the storage contract tests against an S3 mock ([#620](https://github.com/hyperwatch/hyperwatch/pull/620))

## 5.1.0 (2026-09-29)

### Breaking changes

- `/addresses` JSON and CSV: `identity` is now `lastIdentity` and `agent` is now `lastAgent`. `/identities` JSON and CSV: `agent` is now `lastAgent`. Clients reading these fields, like `@hyperwatch/dashboard`, need updating ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- The `sparkline` module is removed: configurations enabling it are ignored and the `activity` column is gone ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- `/logs/<node>` now shows the latest lines at the bottom and starts with up to 100 history lines when `history` is active (`?history=0` for live only) ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- `/nodes` in HTML redirects to the new `/pipeline` page ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))

### Features

- A navigation for the built-in HTML interface, the status page at `/`, a `/pipeline` page, and reworked log streams and aggregator tables: `15m · 24h` and `All · Identified · Unidentified` switches, sortable columns, `?address=`, `?identity=` and `?signature=` filters on logs ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- The Hyperwatch version is shared with clients in an `X-Hyperwatch-Version` header on HTTP responses and WebSocket handshakes, shown in the websocket input's status, and exported as `hyperwatch.version` ([#605](https://github.com/hyperwatch/hyperwatch/pull/605))
- Durations over an hour are shown in hours (`9h15m26s` instead of `555m26s`) ([#604](https://github.com/hyperwatch/hyperwatch/pull/604))

### Fixes

- Values shown in the HTML interface are escaped: a user agent containing HTML could run script for whoever opened `/logs` or `/addresses` ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- The websocket input retries within seconds when a server cuts the connection right after opening, instead of waiting 10s each time, for clients following several servers behind a load balancer ([#602](https://github.com/hyperwatch/hyperwatch/pull/602))
- `mount()` answers `404` to WebSocket upgrades outside its path when no `fallback` or other listener handles them, instead of leaving them hanging ([#610](https://github.com/hyperwatch/hyperwatch/pull/610))
- Input statuses fill in the host and mount path in `http://__HOST__/...` ([#600](https://github.com/hyperwatch/hyperwatch/pull/600))
- `formatDuration` no longer shows `1m60s` ([#604](https://github.com/hyperwatch/hyperwatch/pull/604))

### Identities

- `github-camo` is identified from the ranges GitHub publishes for its services ([#606](https://github.com/hyperwatch/hyperwatch/pull/606))
- The Google Docs proxy is identified again ([#606](https://github.com/hyperwatch/hyperwatch/pull/606))

### Dependencies & tooling

- Bumped dnsbl to 6, csv-stringify and prettier ([#607](https://github.com/hyperwatch/hyperwatch/pull/607), [#608](https://github.com/hyperwatch/hyperwatch/pull/608), [#609](https://github.com/hyperwatch/hyperwatch/pull/609))
- The release guide has a Fixes section ([#598](https://github.com/hyperwatch/hyperwatch/pull/598))

## 5.0.1 (2026-09-24)

### Fixes

- Persist on shutdown even when a websocket input is still connecting. Stopping a websocket input mid-connection used to throw, so nothing was saved and the process didn't exit. Inputs now stop independently, failures are reported, and state is persisted regardless ([#595](https://github.com/hyperwatch/hyperwatch/pull/595))
- Hostname verification now forward-confirms IPv6 addresses, accepts a match on any returned address, and compares IPv6 in canonical form ([#596](https://github.com/hyperwatch/hyperwatch/pull/596))

### Identities

- Add SEOkicks, identified by a verified `seokicks.de` hostname ([#596](https://github.com/hyperwatch/hyperwatch/pull/596))
- Add Linkup (LinkupBot), identified by its published IP ranges ([#596](https://github.com/hyperwatch/hyperwatch/pull/596))
- Name every Semrush crawler (SiteAuditBot, SplitSignalBot, SemrushBot-SWA/-OCOB/-FT/-ESI, RyteBot), identified by a verified `semrush.com` hostname or Semrush's IP range, with a fallback for crawlers not listed yet ([#596](https://github.com/hyperwatch/hyperwatch/pull/596))
- SEOkicks, Semrush and Reflection now require a forward-confirmed hostname ([#596](https://github.com/hyperwatch/hyperwatch/pull/596))

### Dependencies & tooling

- Add a release guide (`RELEASING.md`) and agent notes (`AGENTS.md`) ([#594](https://github.com/hyperwatch/hyperwatch/pull/594))

## 5.0.0 (2026-09-24)

### Breaking changes

- **Node.js >= 24 is required**, following the upgrade to geoip-lite 2.x ([#548](https://github.com/hyperwatch/hyperwatch/pull/548)).
- **Express 5** ([#514](https://github.com/hyperwatch/hyperwatch/pull/514)): `hyperwatch.app.api` and the WebSocket routers are now Express 5, and express-ws is replaced by built-in WebSocket upgrade handling. This matters for apps that embed Hyperwatch; use `hyperwatch.app.mount()` ([#588](https://github.com/hyperwatch/hyperwatch/pull/588), see `docs/embedding.md`).

### Features

- Persist history buffers across restarts when persistence is enabled ([#591](https://github.com/hyperwatch/hyperwatch/pull/591))
- `hyperwatch.app.mount()` to embed Hyperwatch, including its live WebSocket streams, in an Express app ([#588](https://github.com/hyperwatch/hyperwatch/pull/588))
- 15m and 24h distinct address and signature counts ([#583](https://github.com/hyperwatch/hyperwatch/pull/583)), bounded to a rolling 24h window ([#574](https://github.com/hyperwatch/hyperwatch/pull/574)). Dumps in the old format are discarded on load and the counts rebuild from live traffic ([#584](https://github.com/hyperwatch/hyperwatch/pull/584)).
- 2xx/4xx status counts, `/nodes` endpoint, aggregator reset, and an address enricher with signature tracking ([#545](https://github.com/hyperwatch/hyperwatch/pull/545))

### Identities

- New: Reflection ([#592](https://github.com/hyperwatch/hyperwatch/pull/592)), Exa ([#560](https://github.com/hyperwatch/hyperwatch/pull/560)), You.com and Lyrenth ([#573](https://github.com/hyperwatch/hyperwatch/pull/573)), ShapBot ([#557](https://github.com/hyperwatch/hyperwatch/pull/557)), Sofya ([#556](https://github.com/hyperwatch/hyperwatch/pull/556))
- Claude crawlers are verified against Anthropic's published IP ranges ([#558](https://github.com/hyperwatch/hyperwatch/pull/558))
- Meta no longer trusts Cloudflare Workers egress `2a06:98c0:3600::/48` ([#590](https://github.com/hyperwatch/hyperwatch/pull/590))
- IP range updates for OpenAI, CloudFront and Amazon ([#580](https://github.com/hyperwatch/hyperwatch/pull/580))

### Dependencies & tooling

- chalk 6 ([#563](https://github.com/hyperwatch/hyperwatch/pull/563)), syslog-parse 2 ([#531](https://github.com/hyperwatch/hyperwatch/pull/531)), dnsbl 5 ([#542](https://github.com/hyperwatch/hyperwatch/pull/542))
- ESLint 10, with eslint-plugin-import-x replacing eslint-plugin-import
- Committed lockfile for reproducible installs ([#565](https://github.com/hyperwatch/hyperwatch/pull/565)); Node 26 added to the CI matrix ([#559](https://github.com/hyperwatch/hyperwatch/pull/559))
- Documentation refresh, and a fix for the `hyperwatch_combined` format key in configs ([#587](https://github.com/hyperwatch/hyperwatch/pull/587))
- Routine dependency updates (lru-cache, proxy-addr, js-yaml, mocha, prettier, eslint, lint-staged, globals and others)

**Full Changelog**: https://github.com/hyperwatch/hyperwatch/compare/v4.3.1...v5.0.0
