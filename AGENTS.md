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

## Types

The sources are JavaScript with JSDoc types, checked by TypeScript (`checkJs`, not `strict` yet): `npm run type:check` must pass, as in CI.

- Type options objects and anything public with JSDoc (`@param`, `@returns`, `@typedef`). Shared types (`Log`, `Config`, `ModuleConfig`, `Abortable`) are in `src/types.js`.
- `npm run types` generates the declarations the package publishes (`types/`, not committed; `prepack` runs it). `npm run types:test` packs the package, installs it in a temporary project with its dependencies only, and type-checks `test/types/consumer.ts` and every published declaration, strict and without `skipLibCheck`: add a line to `consumer.ts` when the public API changes, and an `@ts-expect-error` for what must be rejected.
- A class used as a type in another module must be exported by name (`module.exports.X = X`, or a `@typedef` next to `module.exports = { … }`): `import('./x').X` doesn't see classes in an object literal. A module exporting an instance (`pipeline.js`) exports its class's type with a `@typedef` (`Root`), and modules re-exporting it cast to that type, so the declarations refer to it instead of copying it.
- The published declarations may only refer to packages users get: dependencies with their own types, `@types` packages in `dependencies` (`@types/express`, `@types/ws`), Node's modules. Otherwise declare the type in JSDoc (as `GeoipLookup` for geoip-lite); `types:test` fails when a declaration needs a devDependency.

## Web Bot Auth agents

The `webbotauth` module only fetches the key directories of the agents in `src/data/webbotauth-agents.json`. To add one, check that its directory answers with Ed25519 keys and that real signed requests verify, add it to the file, run `node scripts/fetch-webbotauth-keys.js <agent>`, and accept its verified signature in the robot's `identity` rule (`signedBy`).
