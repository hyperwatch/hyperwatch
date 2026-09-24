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
- Use `addEntry` / `removeEntry` from `src/lib/firewall/lists` to edit the file from code. `save` writes atomically.

## HTTP API

Besides the `/firewall` aggregator (matches per list), the module serves:

| Endpoint                          | Description                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /firewall/lists.json`        | All lists and their entries. Linked lists get `pending: { added, removed }` since the last sync, or `null` if never synced |
| `POST /firewall/lookup`           | `{ "addresses": [...], "user_agents": [...] }` → the matching `{ list, action, value }` (or `null`) for each               |
| `POST /firewall/lists/:id/add`    | `{ "value", "reason", "source" }` adds an entry                                                                            |
| `POST /firewall/lists/:id/remove` | `{ "value" }` removes an entry                                                                                             |

Edits write `firewall.json` and apply right away. They don't touch Cloudflare: run `hyperwatch firewall sync up` to push them.

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
- The last agreed state is kept in `firewall.sync.json`, next to `firewall.json`. Keep that file with `firewall.json`: without it, the next sync is treated as a first sync, and removals are lost. On a first sync, `down` imports every value only in Cloudflare and `up` pushes every value only in `firewall.json`.
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
hyperwatch firewall migrate <legacy-firewall.json> [--out firewall.json] [--force]
```

`hyperwatch firewall` is only treated as a firewall command when it's followed by one of these commands, an option, or nothing. Any other `hyperwatch <path>` still starts the server with that config file.

`migrate` converts the older rule-based format (`{ "rules": [{ "id", "action", "match", "cloudflare" }] }`):

- Rules that only match IPs (`address`, `addresses`, `cidrs`) or exact user agents (`user_agents`) become lists. Cloudflare-linked rules keep their link.
- Everything else (signatures, headers, identity, ASNs, `ua_regex`, combined conditions) is written unchanged to `firewall.legacy.json`.
