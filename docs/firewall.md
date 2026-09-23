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

## Syncing with Cloudflare

Each linked list owns one custom rule in the zone's `http_request_firewall_custom` phase. Hyperwatch writes the rule's whole expression:

- `ip`: `(ip.src in {203.0.113.7 2001:db8::/32})`
- `user_agent`: `(http.user_agent eq "a") or (http.user_agent eq "b")`, or `contains` for `contains` lists

```sh
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... hyperwatch-firewall sync --dry-run
```

The token needs permission to edit the zone's WAF custom rules. `--dry-run` only reads them.

Sync is two-way:

- Values added or removed on either side since the last sync are applied to the other side. The first sync takes the union of both.
- Values added in Cloudflare are added to `firewall.json` with `"source": "cloudflare"`.
- The last agreed state is kept in `firewall.sync.json`, next to `firewall.json`. Keep that file with `firewall.json`: without it, the next sync is treated as a first sync, and removals are lost.
- Cloudflare is updated first, then `firewall.json`. If either side changes while a sync runs, that part is left alone, and the next sync finishes the job.

Sync refuses to touch a list, and says why, when:

- the rule's expression isn't one Hyperwatch would write (someone edited the rule by hand)
- the rule's action or description differs from the list. Choose a side with `--prefer local` or `--prefer remote`
- the expression would go over Cloudflare's 4,096-character limit. Split the list
- the rule would end up empty

A rule's enabled/disabled state is left as it is in Cloudflare.

## CLI

```
hyperwatch-firewall sync [--dry-run] [--prefer local|remote] [--list <id>] [--file firewall.json] [--state firewall.sync.json]
hyperwatch-firewall check [--file firewall.json]
hyperwatch-firewall migrate <legacy-firewall.json> [--out firewall.json] [--force]
```

`migrate` converts the older rule-based format (`{ "rules": [{ "id", "action", "match", "cloudflare" }] }`):

- Rules that only match IPs (`address`, `addresses`, `cidrs`) or exact user agents (`user_agents`) become lists. Cloudflare-linked rules keep their link.
- Everything else (signatures, headers, identity, ASNs, `ua_regex`, combined conditions) is written unchanged to `firewall.legacy.json`.
