---
name: release
description: Release a new version of @hyperwatch/hyperwatch, following RELEASING.md. Refreshes the published ranges and keys, checks origin/main, drafts the release notes and the version, then, step by step with the maintainer's approval, the version commit and tag, the push, the npm publish (run by the maintainer) and the GitHub release. Use when asked to release, cut, ship or publish a new Hyperwatch version, or to prepare the release notes.
---

# Release

[RELEASING.md](../../../RELEASING.md) is the procedure, and the "Release management" section of [AGENTS.md](../../../AGENTS.md) adds the rules for agents. Read both first, every time: this skill only says where to stop and which helper to use. Where they differ, they win.

`node scripts/release.js` does the steps that need no decision:

- `check`: the tree is `origin/main` and unchanged, `test`, `lint`, `prettier:check`, `type:check`, `types:test` and `depcheck` pass, and the package holds only what `files` allows (steps 2–3).
- `changes`: the last release (tag and npm), and a draft of the notes from the commits since (step 4).
- `notes X.Y.Z [file]`: the `CHANGELOG.md` section of a version, for the GitHub release (step 8).

It never commits, tags, pushes or publishes.

## Steps

1. **Refresh the published ranges and keys** ("Before you start" in RELEASING.md), in its own worktree. If a list fails to fetch, stop and report it. If anything changed, open the refresh PR with its table of what was added and removed, and wait for it to be merged before going on. Also compare the lists copied by hand with their sources.
2. **Release worktree** from `origin/main` (step 1). Never switch branches in the main checkout.
3. **`npm ci`, then `node scripts/release.js check`.** On any failure, stop and report: it gets fixed on `main` through a PR, not in the release.
4. **`node scripts/release.js changes`.** Turn the draft into the notes:
   - sort the "To sort" lines into Breaking changes, Features, Fixes and Identities, and rewrite them for users of the package (what changed for them, not how), in the style of the previous entries of `CHANGELOG.md`;
   - read the PRs when a subject isn't enough (`gh pr view N`);
   - leave out what users can't see (CI, tests, refactors) or fold it into Dependencies & tooling;
   - nothing about unmerged work.

   Propose a version with semver (RELEASING.md step 4 says what is major).

5. **Stop: show the maintainer the version and the notes**, and wait for their approval or changes.
6. **Changelog, version commit and tag** (step 5), exactly as RELEASING.md writes them: one `version X.Y.Z` commit with `package.json`, `package-lock.json` and `CHANGELOG.md`, and an annotated tag.
7. **Stop: ask before pushing** (step 6). The maintainer often runs the push themselves; give them the command. If it is rejected, follow RELEASING.md and start again from step 3.
8. **npm publish: the maintainer runs it** (step 7), it needs their login and 2FA. Give them the command. Once they say it's published, check `npm view @hyperwatch/hyperwatch dist-tags` in the background until `latest` is the new version: npm can take a few minutes, don't ask them again.
9. **Stop: ask before creating the GitHub release** (step 8). Write the notes with `node scripts/release.js notes X.Y.Z <file outside the worktree>`, then `gh release create` as RELEASING.md writes it.
10. **Clean up** the worktrees (step 9), and report: the version, the links to the tag, the GitHub release and the npm page, and the projects that depend on Hyperwatch to update ("After the release").
