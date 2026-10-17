## Relay a legacy Apache server behind Cloudflare to a current Hyperwatch

This tutorial describes a two-server setup:

- a **legacy server** running Apache behind Cloudflare, on an old system that can't run a current Node.js. It keeps an old Hyperwatch (3.9.3), which only parses the Apache logs and streams them, unenriched;
- a **new server** running the current Hyperwatch (5.3.1), which consumes that stream and does all the enrichment: Cloudflare client address, reverse DNS, User-Agents, aggregations and identities.

```
Apache ──syslog :1514──> Hyperwatch 3.9.3 ──ws :3009 /logs/raw──> Hyperwatch 5.3.1
(legacy server)          (legacy server)                          (new server)
```

The stream between the servers is plain `ws://`, without authentication. Read [Security](#security) before running this over the public Internet.

### How the Cloudflare client address flows

1. Cloudflare proxies the request to Apache, which sees a Cloudflare edge address as the client (`%h`), and the visitor's in the `CF-Connecting-IP` header.
2. Apache logs `CF-Connecting-IP`, `CF-IPCountry` and `CF-Ray` along with the usual fields.
3. Hyperwatch 3.9.3 parses the log. The headers end up in `request.headers` (`cf-connecting-ip`, `cf-ipcountry`, `cf-ray`).
4. The raw JSON log is streamed over `/logs/raw`.
5. On Hyperwatch 5.3.1, the `cloudflare` module replaces the edge address with the visitor's (`address.value`), and sets the country (`address.country-code`) and the data center (`cloudflare.data-center`).
6. `hostname` then does the reverse DNS lookup of the visitor's address.
7. `address`, `signature` and `identity` aggregate and identify traffic from that data.

Before Apache logged the Cloudflare headers, `hostname` was looking up addresses such as `104.22.x.x` and `172.68.x.x`: Cloudflare edge addresses, which generally have no PTR record. Every request from every visitor was attributed to a handful of Cloudflare addresses, and hostnames and identities were missing. The headers must be in the log for the `cloudflare` module to do anything.

### Legacy server

Tested with Ubuntu 18.04, Node.js 16.20.2 and `@hyperwatch/hyperwatch` 3.9.3.

#### Apache

Define the `hyperwatch_combined` format, extended with the Cloudflare headers, and pipe the access logs to Hyperwatch over syslog:

```apache
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-agent}i\" \"%{Accept}i\" \"%{Accept-Charset}i\" \"%{Accept-Encoding}i\" \"%{Accept-Language}i\" \"%{Connection}i\" \"%{Dnt}i\" \"%{From}i\" \"%{Host}i\" \"%{CF-Connecting-IP}i\" \"%{CF-IPCountry}i\" \"%{CF-Ray}i\"" hyperwatch_combined
CustomLog "|/usr/bin/logger --tcp -n 127.0.0.1 -P 1514 --rfc3164 --size 8192" hyperwatch_combined
```

`logger` sends messages of up to 1 KiB by default, and the Cloudflare headers can make lines longer: `--size 8192` keeps them whole. `--tcp` avoids losing logs the way UDP can.

```bash
apachectl configtest && systemctl reload apache2
```

#### Hyperwatch 3.9.3

The built-in Apache format (`format.apache.formats.hyperwatchCombined` in 3.x, `hyperwatch_combined` in 5.x) doesn't include the Cloudflare fields, so the full format string is passed to `format.apache.parser()`. It must match the Apache `LogFormat` exactly:

```javascript
// /root/apache_hyperwatch_combined.js
const APACHE_FORMAT =
  '%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-agent}i" "%{Accept}i" "%{Accept-Charset}i" "%{Accept-Encoding}i" "%{Accept-Language}i" "%{Connection}i" "%{Dnt}i" "%{From}i" "%{Host}i" "%{CF-Connecting-IP}i" "%{CF-IPCountry}i" "%{CF-Ray}i"';

module.exports = function (hyperwatch) {
  const { pipeline, input, format } = hyperwatch;

  hyperwatch.init({
    port: 3009,
    modules: {
      logs: { active: true },
    },
  });

  pipeline.registerInput(
    input.syslog.create({
      name: 'Syslog (Apache hyperwatch_combined + Cloudflare)',
      port: 1514,
      parse: format.apache.parser({ format: APACHE_FORMAT }),
    })
  );
};
```

Run it with [pm2](https://pm2.keymetrics.io/), so it restarts if it crashes. Pin pm2 6.0.14, which works on this system, where later versions had compatibility issues:

```bash
npm install -g pm2@6.0.14
pm2 start /usr/bin/hyperwatch --name apache_hyperwatch_combined_pm2 -- /root/apache_hyperwatch_combined.js
```

To start it again after a reboot, save the process list and install pm2's startup script:

```bash
pm2 save
pm2 startup
```

Only `logs` is active: it serves the web and WebSocket streams on port 3009. No enrichment module runs here.

#### Firewall

Allow port 3009 from the new server only. Hyperwatch 3.9.3 has no authentication, and the stream holds visitors' addresses, URLs and headers:

```bash
ufw allow from <new-server> to any port 3009 proto tcp
```

The syslog port (1514) only needs to be reachable from `127.0.0.1`: don't open it.

The source address limits who can connect, not who can read the traffic: see [Security](#security).

#### Why `/logs/raw` and not `/logs/main`

`raw` is the output of the inputs, before any module. `main` is where modules add their data. The legacy server runs no enrichment module, so both carry the same logs today, but `raw` makes it explicit that the receiver gets parsed logs only, and keeps it that way if a module is turned on on the legacy server. Enrichment belongs on the receiving server, which runs the current modules, their data (Cloudflare, bots and crawlers ranges), and the reverse DNS lookups on the visitor's address.

### New server

Use the current Hyperwatch release, 5.3.1 at the time of writing (Node.js 24 or later):

```bash
npm install -g @hyperwatch/hyperwatch@5.3.1
```

The only input is a WebSocket client connected to the legacy server's `/logs/raw`:

```javascript
// receiver.js
module.exports = function (hyperwatch) {
  const { pipeline, input } = hyperwatch;

  hyperwatch.init({
    modules: {
      logs: { active: true },
      cloudflare: { active: true },
      agent: { active: true },
      hostname: { active: true },
      address: { active: true },
      signature: { active: true },
      identity: { active: true },
      history: { active: true, capacity: 100 },
    },
  });

  pipeline.registerInput(
    input.websocket.create({
      name: 'Legacy Apache',
      type: 'client',
      address: 'ws://<legacy-server>:3009/logs/raw',
      reconnectOnClose: true,
    })
  );
};
```

```bash
hyperwatch receiver.js
```

Modules run in the order of their priority, not of the configuration: `cloudflare` (500) runs before `hostname` (502), and both before `address`, `signature` and `identity` (600 to 620). See [Global Configuration](../configuration.md#modules).

The interface is on port 3000 (`PORT` to change it): `/status`, `/logs/main`, `/addresses`, `/identities`.

### Verification and troubleshooting

On the legacy server, check Hyperwatch is running and listens on 3009 and 1514, and the firewall rule:

```bash
pm2 status
pm2 logs apache_hyperwatch_combined_pm2
ss -lntup | grep -E '3009|1514'
ufw status
```

After changing the configuration: `pm2 restart apache_hyperwatch_combined_pm2`.

Watch the stream in one terminal, and send a test line through syslog in another:

```bash
curl -s http://127.0.0.1:3009/logs/raw
```

```bash
logger --tcp -n 127.0.0.1 -P 1514 --rfc3164 '172.68.1.2 - - [05/Oct/2026:12:00:00 +0000] "GET / HTTP/1.1" 200 123 "-" "curl/7.58.0" "*/*" "-" "gzip" "-" "close" "-" "-" "example.org" "203.0.113.7" "FR" "8c1d2e3f4a5b6c7d-CDG"'
```

On the new server, this log shows `203.0.113.7` as its address on `/logs/main`, with `FR` and the `CDG` data center.

On the new server, check the stream is reachable, then the input on `/status`: `Listening to ws://<legacy-server>:3009/logs/raw`.

```bash
curl -s http://<legacy-server>:3009/logs/raw
```

If some logs are rejected by the parser (counted on the legacy server's `/status`), check the `--size` option of the `CustomLog` line: without it, `logger` cuts lines at 1 KiB.

### Security

This setup is known not to be secure over the public Internet, and is accepted as such:

- The stream between the servers is plain `ws://`: visitors' addresses, URLs and headers travel unencrypted, and can be intercepted on the way.
- Hyperwatch 3.9.3 has no authentication. The UFW rule only limits who can connect to port 3009, by source address.
- The Cloudflare headers are trusted as they are. If Apache is reachable directly, not only through Cloudflare, anyone can send their own `CF-Connecting-IP`, `CF-IPCountry` and `CF-Ray`, and Hyperwatch records the address and country they chose.

To secure it, connect the servers through a private network or a VPN (e.g. WireGuard), or put a TLS-terminating proxy with authentication in front of port 3009 (e.g. Apache with `mod_proxy_wstunnel` and Basic Auth), and use `wss://` with the WebSocket input's `username` and `password` options.

To trust the Cloudflare headers, only accept HTTP and HTTPS on the legacy server from [Cloudflare's IP ranges](https://www.cloudflare.com/ips/).
