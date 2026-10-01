# Firewall

The `firewall` module tags requests whose IP address or User-Agent is on a list, and can keep each list in sync with a Cloudflare WAF custom rule.

Hyperwatch doesn't block anything itself: matching logs get a `firewall` field (`{ list, action, value }`), and the `/firewall` endpoint counts matches per list. Blocking happens at the edge, in Cloudflare.

## Enabling the module

```JSON
{
  "modules": {
    "firewall": { "active": true, "path": "/path/to/firewall.json" }
  }
}
```

`path` defaults to `firewall.json` in the working directory. The file is reloaded within 5 seconds of a change. If a change is invalid, the previous lists stay in use and a warning is printed.

### Storing the lists elsewhere (S3)

The lists and their sync state can live in the storage that persistence uses instead of local files, e.g. S3 on a platform with an ephemeral disk, so edits made through the HTTP API survive restarts and deploys. The location follows `modules.firewall.backend`, else `persistence.backend` (see [Persistence](./configuration.md#persistence)):

| Backend          | Lists                                         | Sync state                                         |
| ---------------- | --------------------------------------------- | -------------------------------------------------- |
| `file` (default) | `modules.firewall.path` (`./firewall.json`)   | Next to it, `firewall.sync.json`                   |
| `s3`             | `<prefix><namespace>/firewall.json` in bucket | `<prefix><namespace>/firewall.sync.json` in bucket |

```json
{
  "persistence": {
    "enabled": true,
    "backend": "s3",
    "namespace": "all",
    "s3": { "bucket": "my-hyperwatch-bucket", "region": "us-east-1" }
  },
  "modules": { "firewall": { "active": true } }
}
```

- Only the backend is shared with persistence: the firewall uses it whether `persistence.enabled` is on or not. `"backend": "file"` under `modules.firewall` keeps the lists in a local file while persistence uses S3.
- With a storage backend, the lists are read when Hyperwatch starts, before the inputs (within `persistence.deadlines.load`), and when the instance edits or syncs them. They aren't polled: nothing else is expected to change them.
- Edits through the HTTP API and syncs run one at a time, each reading the stored lists, changing them and writing them back.
- Nothing is stored at first: the module starts from the lists declared in the configuration (below), and writes them on the first change, e.g. when the first sync brings their entries from Cloudflare.

### Declaring lists in the configuration

`modules.firewall.lists` declares lists with the same fields as `firewall.json` (below), entries optional:

```json
{
  "modules": {
    "firewall": {
      "active": true,
      "lists": [
        {
          "id": "block-ips",
          "type": "ip",
          "action": "block",
          "cloudflare": { "rule_id": "0123456789abcdef0123456789abcdef" }
        },
        { "id": "monitor-ips", "type": "ip", "action": "monitor" }
      ]
    }
  }
}
```

- When nothing is stored yet, these are the lists. A linked list gets its entries from its Cloudflare rule at the first sync (see [Automatic sync](#automatic-sync)); a local list gets them through the HTTP API.
- Once lists are stored, they win: the configuration only adds the lists they don't have. Changing a declared list's action or description doesn't change the stored list.
- Invalid definitions fail when Hyperwatch starts.

## `firewall.json`

```JSON
{
  "lists": [
    {
      "id": "block-ips",
      "type": "ip",
      "action": "block",
      "cloudflare": { "rule_id": "0123456789abcdef0123456789abcdef" },
      "entries": [
        { "value": "203.0.113.7", "reason": "Spam signups", "added": "2026-09-23", "source": "dashboard" },
        { "value": "2001:db8::/32" }
      ]
    },
    {
      "id": "challenge-user-agents",
      "type": "user_agent",
      "match": "eq",
      "action": "challenge",
      "cloudflare": { "rule_id": "fedcba9876543210fedcba9876543210" },
      "entries": [{ "value": "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/104.0.5112.48" }]
    }
  ]
}
```

| Field        | Description                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| `id`         | Unique list name                                                              |
| `type`       | `ip`: IPv4/IPv6 addresses and CIDRs. `user_agent`: User-Agent strings         |
| `match`      | `user_agent` lists only: `eq` (exact, default) or `contains` (substring)      |
| `action`     | `block`, `challenge` (Cloudflare managed challenge) or `monitor` (local only) |
| `cloudflare` | Optional. `{ "rule_id": "..." }` links the list to a custom rule on the zone  |
| `entries`    | `value` is required. `reason`, `added` and `source` are free-form metadata    |

- The first matching list, in file order, wins.
- IPv6 addresses are stored in their canonical form (`2001:db8::1`). CIDRs must not have host bits set (`10.0.0.0/8`, not `10.0.0.1/8`).
- Use `addEntry` / `removeEntry` from `src/lib/firewall/lists` to edit the lists from code. `save` writes a local file atomically; `src/lib/firewall/store` reads and writes wherever the configuration keeps the lists.

## HTTP API

Besides the `/firewall` aggregator (matches per list), the module serves:

| Endpoint                          | Description                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /firewall/lists.json`        | All lists and their entries. Linked lists get `pending: { added, removed }` since the last sync, or `null` if never synced |
| `POST /firewall/lookup`           | `{ "addresses": [...], "user_agents": [...] }` → the matching `{ list, action, value }` (or `null`) for each               |
| `POST /firewall/lists/:id/add`    | `{ "value", "reason", "source" }` adds an entry                                                                            |
| `POST /firewall/lists/:id/remove` | `{ "value" }` removes an entry                                                                                             |

Edits write the lists (`firewall.json`, or the stored document) and apply right away. With [automatic sync](#automatic-sync), they reach Cloudflare within `delay` seconds; without it, Cloudflare isn't changed.

## Syncing with Cloudflare

Each linked list owns one custom rule in the zone's `http_request_firewall_custom` phase. Hyperwatch writes the rule's whole expression:

- `ip`: `(ip.src in {203.0.113.7 2001:db8::/32})`
- `user_agent`: `(http.user_agent eq "a") or (http.user_agent eq "b")`, or `contains` for `contains` lists

Syncing is done by the running instance (see [Automatic sync](#automatic-sync)). Each sync goes one way:

- `down` applies the values added or removed in Cloudflare since the last sync to the lists, along with the rule's action and description. It never writes to Cloudflare. Values added in Cloudflare get `"source": "cloudflare"`.
- `up` applies the values added or removed in the lists since the last sync to the Cloudflare rule, along with the list's action and description. It never changes the lists.
- Neither direction undoes a change still pending on the side it writes to: `down` doesn't bring back a value removed locally, and `up` doesn't remove a value added in Cloudflare.
- A full sync runs `down`, then `up`.
- The last agreed state is kept in `firewall.sync.json`, next to `firewall.json` (or in the storage, see above). Keep it with the lists: without it, the next sync is treated as a first sync, and removals are lost. On a first sync, `down` imports every value only in Cloudflare and `up` pushes every value only in the lists.
- If the rule or `firewall.json` changes while a sync runs, that list is left alone, and the next sync finishes the job.

Sync refuses to touch a list, and says why, when:

- the rule's expression isn't one Hyperwatch would write (someone edited the rule by hand)
- the rule's action has no list equivalent (`down`)
- the expression would go over Cloudflare's 4,096-character limit. Split the list (`up`)
- the rule would end up empty (`up`)

A rule's enabled/disabled state is left as it is in Cloudflare.

### Automatic sync

The running instance syncs by itself:

```json
{
  "modules": {
    "firewall": {
      "active": true,
      "sync": { "auto": true, "delay": 10, "interval": 300 }
    }
  }
}
```

With `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ZONE_ID` in the environment:

- `delay` seconds (10) after an edit through the HTTP API, `up` pushes it to Cloudflare. Edits made meanwhile go out in the same sync.
- `delay` seconds after start, then every `interval` seconds (300; `0` for never), a full sync runs: `down`, then `up`.
- Edits and syncs run one at a time. A Cloudflare request is abandoned after 30 seconds.
- Each change is logged (`firewall: sync up block-ips: +203.0.113.7 (rule v12)`), and so are lists left alone and failures. The latest sync is on `/status` (`firewall sync`), and in detail in `/status.json?raw=1`.
- `auto` accepts `true`, `1`, `"true"` and `"1"`. Without the Cloudflare variables, it warns and stays off.

There's no review step: an edit through the API, mistakes included, reaches Cloudflare within `delay` seconds. Use a token that can only edit the zone's custom rules (Zone WAF: Edit), and one instance syncing per zone.
