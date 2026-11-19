---
name: release
description: Release a new version of @hyperwatch/hyperwatch through its GitHub Actions workflows, following RELEASING.md. Refreshes the published ranges and keys, proposes the version, runs the Prepare workflow, rewrites the drafted release notes in the version pull request, and follows the Release workflow once the maintainer merged it. Use when asked to release, cut, ship or publish a new Hyperwatch version, or to prepare the release notes.
---

# Release

[RELEASING.md](../../../RELEASING.md) is the procedure, and the "Release management" section of [AGENTS.md](../../../AGENTS.md) adds the rules for agents. Read both first, every time: this skill only says where to stop. Where they differ, they win.

## Steps

1. **Refresh the published ranges and keys** ("Before you start" in RELEASING.md), in its own worktree. If a list fails to fetch, stop and report it. If anything changed, open the refresh PR with its table of what was added and removed, and wait for it to be merged before going on. Also compare the lists copied by hand with their sources.
2. **What changed:** `git fetch origin`, then `node scripts/release.js changes` from a checkout of `origin/main` (a worktree: never switch branches in the main checkout). Read the PRs when a subject isn't enough (`gh pr view N`). Propose a version with semver (RELEASING.md, step 1).
3. **Stop: agree on the version** with the maintainer.
4. **Prepare:** `gh workflow run release-prepare.yml -f version=X.Y.Z`, then follow the run (`gh run watch`). It opens the draft pull request `version X.Y.Z`, or gives the link to open it in the run's summary: then open it with the same title.
5. **Rewrite the notes** in `CHANGELOG.md` on the branch `release-vX.Y.Z` (RELEASING.md, step 2), in a worktree, in the style of the previous entries; push them.
6. **Stop: show the maintainer the notes** and the pull request link. Once they approve, mark it ready (`gh pr ready N`). CI's `release-notes` check must pass.
7. **The maintainer merges** the pull request: never merge it yourself, merging publishes.
8. **Follow the Release workflow** (`gh run list --workflow release.yml`, `gh run watch`). If a step fails, report which and why; after the fix, rerun it (`gh workflow run release.yml`) with the maintainer's approval.
9. **Report** the version, the links to the GitHub release and the npm page, and the projects that depend on Hyperwatch to update ("After the release").
