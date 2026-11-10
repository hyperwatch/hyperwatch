# Agents

Notes for AI coding agents working on this repository.

## Release management

Follow [RELEASING.md](RELEASING.md). On top of it:

- Only `origin/main` ships. Do the release in a separate worktree, and never switch branches in the main checkout: other projects may use it through a symlink.
- Don't mention unmerged branches or modules in the release notes.
- Stop and report if any check in steps 2–3 fails.
- Agree on the version and the release notes with the maintainer before running `npm version`.
- Ask before pushing (step 6) and before creating the GitHub release (step 8). The maintainer usually runs the push to `main` themselves.
- Never run `npm publish`: it needs the maintainer's npm login and 2FA. Give them the command to run instead.
- Build the "changes since" list from what was actually published: check the previous tag, and the published tarball (`npm pack @hyperwatch/hyperwatch@<previous>`) when in doubt.

## Published address lists

Identities are checked against the address lists operators publish (`src/data/*-ips.json`).

- Lists published as structured data (JSON, plain text, one range per line) have a source in `src/data/ip-list-sources.json` and are refreshed by `node scripts/fetch-ips.js`.
- Lists published only inside a page, a table or a PDF are copied by hand, listed in [RELEASING.md](RELEASING.md) ("Some lists have no updater"). Don't write a parser for them: a parser per page breaks silently when the page changes. To refresh them, read each source, update its file in the same format (a JSON array of ranges, single addresses as `/32` or `/128`), run `npx prettier --write src/data`, and report what was added and removed.
- A new operator list: if it is structured, add a source to `ip-list-sources.json`; otherwise copy it by hand, add it to the RELEASING.md list and to `handCopied` in `test/scripts/published-ips.js`.
- Before a release, refresh both kinds ([RELEASING.md](RELEASING.md), "Before you start: refresh the published ranges").
