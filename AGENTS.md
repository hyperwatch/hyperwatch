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
