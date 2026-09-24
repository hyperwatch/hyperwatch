# Releasing

How to release a new version of `@hyperwatch/hyperwatch`.

Releases are cut from `origin/main` only: anything not merged into `main` doesn't ship. Each release is one commit `version X.Y.Z` that only bumps the version, an annotated tag `vX.Y.Z` on it, a publish to npm, and a GitHub release. There is no CHANGELOG file: the GitHub release notes are the changelog.

You need push access to `main`, publish rights on the npm package (with 2FA), and the [GitHub CLI](https://cli.github.com/).

## 1. Prepare a clean worktree

Release from a separate worktree, so your usual checkout and whatever branch it's on stay untouched:

```bash
git fetch origin
git worktree add ../hyperwatch-release origin/main
cd ../hyperwatch-release
```

## 2. Check the tree

```bash
npm ci
npm test
npm run lint
npm run prettier:check
```

Fix anything that fails on `main` first, through a normal PR.

## 3. Check the package contents

```bash
npm pack --dry-run
```

The file list should only contain what the `files` whitelist in `package.json` allows (`bin`, `config`, `docs`, `scripts`, `src`, `start.js`), plus the files npm always adds (`hyperwatch.js`, `LICENSE`, `README.md`, `package.json`). Make sure no local files or secrets slipped in.

## 4. Write the release notes and pick the version

List what changed since the last release:

```bash
git log --no-merges vX.Y.Z..origin/main
```

Write the notes in Markdown, in these sections:

- **Breaking changes**
- **Features**
- **Identities**
- **Dependencies & tooling**, with the dependabot bumps summarized in one line

Link PR numbers as `#NNN`; GitHub turns them into links.

Choose the version with [semver](https://semver.org/). Raising the required Node.js version, or changing the Express major version behind `hyperwatch.app.api`, is a major bump.

## 5. Bump the version

```bash
npm version X.Y.Z -m "version %s"
```

This updates `package.json` and `package-lock.json`, commits them as `version X.Y.Z`, and creates the tag `vX.Y.Z`.

## 6. Push to main

```bash
git push origin HEAD:main vX.Y.Z
```

Push the version commit straight to `main`. Don't open a PR that gets squash- or rebase-merged: that rewrites the commit, and the tag ends up pointing at a commit that isn't on `main` (this happened with `v4.3.1`). If it really has to go through a PR, merge it with a merge commit and push the tag after the merge.

## 7. Publish to npm

```bash
npm publish
```

Check the result with `npm view @hyperwatch/hyperwatch dist-tags`: `latest` should be the new version.

## 8. Create the GitHub release

Save the notes from step 4 to a file outside the worktree (an untracked file there would block the cleanup in step 9), then:

```bash
gh release create vX.Y.Z --repo hyperwatch/hyperwatch --title "X.Y.Z" --notes-file ../hyperwatch-vX.Y.Z-notes.md --latest --verify-tag
```

## 9. Clean up

```bash
cd -
git worktree remove ../hyperwatch-release
git worktree prune
```

## After the release

Update the projects that depend on Hyperwatch. For a major version, their `^` range won't pick it up automatically: bump the range explicitly (for example `^5.0.0`).

## Note on 4.3.1

The `v4.3.1` tag is not on `main`. `main` has rebased copies of that release (`caff220 version 4.3.1`), and a few PRs that come before `caff220` on `main` (#545, #556, #557, #558) were never in the published 4.3.1: they first shipped in 5.0.0. From 5.0.0 on, tags are on `main` and `git log vX.Y.Z..origin/main` is reliable.
