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
- With a storage backend, the lists are read when Hyperwatch starts, before the inputs (within `persistence.deadlines.load`), and after the instance's own edits. They aren't polled: a change made elsewhere, e.g. with the CLI, is picked up at the next restart.
- Edits through the HTTP API run one at a time, each reading the stored lists, changing them and writing them back.
- Nothing is stored at first: copy a local `firewall.json` (and its `firewall.sync.json`) with `hyperwatch firewall import` (see [CLI](#cli)). Until then, the module has no lists and warns.

## `firewall.json`

```JSON
{
  "lists": [
    {
      "id": "block-ips",
      "type": "ip",
      "action": "block",
      "cloudflare": { "rule_id": "c7fdacfb7ae3498a9d268e9117b3f8eb" },
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
      "cloudflare": { "rule_id": "45b7c00748d04d16b213d0dac77f536e" },
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

Edits write the lists (`firewall.json`, or the stored document) and apply right away. They don't touch Cloudflare: run `hyperwatch firewall sync up` to push them.

## Syncing with Cloudflare

Each linked list owns one custom rule in the zone's `http_request_firewall_custom` phase. Hyperwatch writes the rule's whole expression:

- `ip`: `(ip.src in {203.0.113.7 2001:db8::/32})`
- `user_agent`: `(http.user_agent eq "a") or (http.user_agent eq "b")`, or `contains` for `contains` lists

```sh
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... hyperwatch firewall sync down --dry-run
```

The token needs permission to edit the zone's WAF custom rules. `--dry-run` only reads them.

Each sync goes one way:

- `sync down` applies the values added or removed in Cloudflare since the last sync to `firewall.json`, along with the rule's action and description. It never writes to Cloudflare. Values added in Cloudflare get `"source": "cloudflare"`.
- `sync up` applies the values added or removed in `firewall.json` since the last sync to the Cloudflare rule, along with the list's action and description. It never changes `firewall.json`.
- Neither direction undoes a change still pending on the side it writes to: `sync down` doesn't bring back a value you removed locally, and `sync up` doesn't remove a value added in Cloudflare.
- For a full sync, run `sync down`, then `sync up`.
- The last agreed state is kept in `firewall.sync.json`, next to `firewall.json` (or in the storage, see above). Keep it with `firewall.json`: without it, the next sync is treated as a first sync, and removals are lost. On a first sync, `down` imports every value only in Cloudflare and `up` pushes every value only in `firewall.json`.
- If the rule or `firewall.json` changes while a sync runs, that list is left alone, and the next sync finishes the job.

Sync refuses to touch a list, and says why, when:

- the rule's expression isn't one Hyperwatch would write (someone edited the rule by hand)
- the rule's action has no list equivalent (`sync down`)
- the expression would go over Cloudflare's 4,096-character limit. Split the list (`sync up`)
- the rule would end up empty (`sync up`)

A rule's enabled/disabled state is left as it is in Cloudflare.

## CLI

```
hyperwatch firewall sync up|down [--dry-run] [--list <id>] [--file firewall.json] [--state firewall.sync.json]
hyperwatch firewall check [--file firewall.json]
hyperwatch firewall import <firewall.json> [<firewall.sync.json>] [--force]
hyperwatch firewall export <firewall.json> [<firewall.sync.json>] [--force]
hyperwatch firewall migrate <legacy-firewall.json> [--out firewall.json] [--force]
```

`sync`, `check`, `import` and `export` work on the lists where the configuration keeps them (`.hyperwatchrc`, or `hyperwatch_*` environment variables through rc), `./firewall.json` by default. `--file` (and `--state`) use these local files instead. With S3, e.g.:

```sh
hyperwatch_persistence__backend=s3 hyperwatch_persistence__namespace=all \
hyperwatch_persistence__s3__bucket=my-hyperwatch-bucket \
hyperwatch firewall sync up --dry-run
```

- `import` copies a local `firewall.json` into the configured storage, and its sync state when the file exists (by default next to it). It refuses to replace stored lists without `--force`.
- `export` copies the stored lists and sync state into local files, refusing to overwrite them without `--force`.
- A running instance with a storage backend doesn't see changes made by the CLI until it restarts, and its own HTTP edits read the stored lists first, so they don't undo them.

`hyperwatch firewall` is only treated as a firewall command when it's followed by one of these commands, an option, or nothing. Any other `hyperwatch <path>` still starts the server with that config file.

`migrate` converts the older rule-based format (`{ "rules": [{ "id", "action", "match", "cloudflare" }] }`):

- Rules that only match IPs (`address`, `addresses`, `cidrs`) or exact user agents (`user_agents`) become lists. Cloudflare-linked rules keep their link.
- Everything else (signatures, headers, identity, ASNs, `ua_regex`, combined conditions) is written unchanged to `firewall.legacy.json`.
