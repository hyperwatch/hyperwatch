# web-bot-auth (vendored)

CommonJS builds, with their type declarations (`.d.cts`), of Cloudflare's [web-bot-auth](https://github.com/cloudflare/web-bot-auth) packages (`web-bot-auth`, `http-message-sig`, `jsonwebkey-thumbprint`, Apache-2.0, see [LICENSE](LICENSE)) at the commit in [source.json](source.json), used by `src/lib/webbotauth.js`.

They are vendored because the version on npm (`web-bot-auth` 0.2.0, August 2026) predates [draft-ietf-webbotauth-httpsig-protocol-01](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) and rejects signatures the draft accepts: it requires `alg` and a 64-byte nonce. The repository's `main` follows the draft, but isn't published yet, and npm can't install a package from a subdirectory of a repository.

Don't edit these files: Hyperwatch's changes to them are patches in the script, applied to each build. There is one, in `index.cjs`: a legacy `Signature-Agent` sent as a bare URL (`https://ibou.io`, as Babbar does) instead of a structured-field string (`"https://ibou.io"`) is accepted as that string. The signature still covers the header as sent. To update them:

```bash
node scripts/vendor-web-bot-auth.js <commit>
npm test
```

The script builds the three packages at that commit, applies the patches (it stops if one no longer applies) and rewrites the requires between them to relative paths; `structured-headers` stays a dependency of Hyperwatch, at the version `http-message-sig` pins. Once npm has a version at least as recent, depend on `web-bot-auth` again and remove this directory and the script.
