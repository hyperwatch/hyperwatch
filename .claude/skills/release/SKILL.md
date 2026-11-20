---
name: release
description: Release a new version of @hyperwatch/hyperwatch with its GitHub Actions workflows, following RELEASING.md. Does the parts that need judgment: refreshing the published lists (including those copied by hand), proposing the version, and rewriting the drafted release notes. Use when asked to release, cut, ship or publish a new Hyperwatch version, or to prepare the release notes.
---

# Release

[RELEASING.md](../../../RELEASING.md) is the procedure and the "Release management" section of [AGENTS.md](../../../AGENTS.md) the rules (what to agree on with the maintainer, never merge). Read both first, every time. The workflows do the mechanical steps; this is what's left to you. Work in worktrees: never switch branches in the main checkout.

1. **Refresh the published lists and categories.** Run the Refresh workflow (`gh workflow run refresh.yml`, then `gh run watch`). In its pull request (or on its branch, through the link in the run's summary):
   - lists, agents or categories that couldn't be refreshed: retry the workflow later, or find out why;
   - the robot categories' report, when they changed: what RELEASING.md says to look for (an identity losing its category, a new category);
   - the lists copied by hand: read each source listed in RELEASING.md, update the files that changed, and add them to the pull request's table, or say they are unchanged.

   The maintainer merges it before the release.

2. **Propose the version.** `node scripts/release.js changes` on an up-to-date `origin/main` lists the commits since the last release. Read the PRs when a subject isn't enough (`gh pr view N`), and propose a version with semver (RELEASING.md, step 1). Agree on it.
3. **Prepare.** `gh workflow run release-prepare.yml -f version=X.Y.Z`. If the run's summary gives a link instead of a pull request, open it with the title `version X.Y.Z`.
4. **Rewrite the notes** in `CHANGELOG.md` on `release-vX.Y.Z` (RELEASING.md, step 2), in the style of the previous entries: for the package's users, nothing about unmerged work, no "To sort" left. Push, then agree on them before marking the pull request ready.
5. **After the maintainer's merge**, follow the Release workflow (`gh run list --workflow release.yml`). On a failure, report the step and why. Then report the GitHub release and npm links, and the projects to update ("After the release").
