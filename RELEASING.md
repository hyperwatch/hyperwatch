# Releasing

How to release a new version of `@hyperwatch/hyperwatch`.

Releases are made by two GitHub Actions workflows, from `main` only: anything not merged into `main` doesn't ship.

- [**Prepare a release**](.github/workflows/release-prepare.yml) (run by hand) opens the pull request `version X.Y.Z`: `package.json` and `package-lock.json` bumped, and the release notes drafted in `CHANGELOG.md`.
- [**Release**](.github/workflows/release.yml) (on each push to `main`) releases `package.json`'s version when it isn't released yet: the checks, `npm publish`, an annotated tag `vX.Y.Z` on the commit that set the version, and a GitHub release with its notes.

`node scripts/release.js` holds what they share (`changes`, `prepare`, `verify`, `pack`, `notes`: see its header). It never commits, tags, pushes or publishes.

## Before you start: refresh the published ranges and keys

Several identities are checked against address lists their operators publish (`src/data/*-ips.json`). Refresh them all before each release, so it ships with current ranges. Do it in a separate worktree, with dependencies installed (the updater needs them):

```bash
git fetch origin
git worktree add -b refresh-ranges ../hyperwatch-refresh origin/main
cd ../hyperwatch-refresh
npm ci
node scripts/fetch-ips.js
node scripts/fetch-webbotauth-keys.js
npx prettier --write src/data
git status --short src/data
```

`scripts/fetch-webbotauth-keys.js` refreshes the keys of the Web Bot Auth agents in `src/data/webbotauth-keys.json` the same way. `scripts/fetch-ips.js` fetches every list in `src/data/ip-list-sources.json`. A list that can't be fetched or parsed, is empty, or has an invalid entry keeps its current file; the script names it at the end and exits with a non-zero status. If one failed, stop: retry later (`node scripts/fetch-ips.js <name>` refreshes only that list), or find out why, rather than release with a list that wasn't refreshed.

Some lists have no updater: their operators publish them only inside a page, a table or a PDF, and a parser per page would break silently when the page changes. Compare them with their source too, by hand or by asking an agent to read each source below and update the file, then review the diff:

- `amazonbot-ips.json`, `amazon-searchbot-ips.json`, `amazon-user-ips.json`: the JSON embedded in Amazon's pages for [Amazonbot](https://developer.amazon.com/amazonbot/ip-addresses/), [Amzn-SearchBot](https://developer.amazon.com/amazonbot/searchbot-ip-addresses/) and [Amzn-User](https://developer.amazon.com/amazonbot/live-ip-addresses/).
- `amazon-quick-ips.json`: the table of [Amazon Quick's regions](https://docs.aws.amazon.com/quick/latest/userguide/regions.html).
- `daumbot-ips.json`: [daumbot.json](https://webmaster.daum.net/crawler/daumbot.json). Its server doesn't send its intermediate certificate, so Node can't fetch it, but curl can: `curl -s https://webmaster.daum.net/crawler/daumbot.json`.
- `360spider-ips.json`: the PDF linked from [360's spider page](https://www.so.com/help/spider_ip.html), one address per line (`pdftotext` reads it).
- `dataforseo-ips.json`: the IPv4 and IPv6 subnets written under "IPv4:" and "IPv6:" on [DataForSEO's bot page](https://dataforseo.com/dataforseo-bot).
- `marginalia-ips.json`: the addresses written after "IP address:" under "Crawler Fingerprint" on [Marginalia's page for webmasters](https://www.marginalia.nu/marginalia-search/for-webmasters/) (`193.183.0.162-174` as CIDRs).

If any list or key changed, run `npm test`, then open a PR named after what changed: "Refresh the published IP ranges", "Refresh the Web Bot Auth keys", or "Refresh the published IP ranges and Web Bot Auth keys". Give a table of the ranges and keys added and removed per file, and the lists left unchanged (as in [#636](https://github.com/hyperwatch/hyperwatch/pull/636)). Merge it before step 1; its line lands under **Identities** in the drafted notes. If nothing changed, go on.

Then remove the refresh worktree and its branch, so the next release can create them again:

```bash
cd -
git worktree remove ../hyperwatch-refresh
git branch -D refresh-ranges
```

## 1. Prepare the pull request

Pick the version with [semver](https://semver.org/): raising the required Node.js version, or changing the Express major version behind `hyperwatch.app.api`, is a major bump. `node scripts/release.js changes` lists what changed since the last release, on npm and as a tag, to decide. Then run the workflow:

```bash
gh workflow run release-prepare.yml -f version=X.Y.Z
```

It pushes the branch `release-vX.Y.Z` and opens the draft pull request `version X.Y.Z`. If the repository doesn't allow GitHub Actions to create pull requests (Settings → Actions → General), the run's summary gives the link to open it.

## 2. Rewrite the release notes

The notes are drafted in `CHANGELOG.md`, under `## X.Y.Z (YYYY-MM-DD)`: PR links in full, dependabot bumps in one line under **Dependencies & tooling**, refreshes of the published lists under **Identities**, the rest under **To sort**. Rewrite them in these sections, with `###` headings (skip the empty ones):

- **Breaking changes**
- **Features**
- **Fixes**
- **Identities**
- **Dependencies & tooling**, with the dependabot bumps summarized in one line

Write for the package's users: what changed for them, not how; leave out what they can't see (CI, tests, refactors), or fold it into Dependencies & tooling. Link PR numbers in full, as `([#NNN](https://github.com/hyperwatch/hyperwatch/pull/NNN))`: GitHub doesn't turn a bare `#NNN` into a link in a Markdown file.

Push the notes to the branch, mark the pull request ready, and merge it once CI passes. The `release-notes` check (and the release) refuses notes that still have a "To sort" section. Any merge method works: the tag is created after the merge, on the commit it put on `main`.

## 3. The release

Merging starts the Release workflow (`gh run watch`). From the commit that set the version, it:

1. checks the notes (`release.js verify`), then runs `npm test`, `lint`, `prettier:check`, `type:check`, `types:test`, `depcheck`, and checks the package contents (`release.js pack`: only what the `files` whitelist of `package.json` allows, plus what npm always adds);
2. publishes to npm, with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (no token);
3. tags the commit `vX.Y.Z`;
4. creates the GitHub release `X.Y.Z`, with the version's section of `CHANGELOG.md` and a link to npm.

Each step is skipped when already done: if one fails, fix the cause and rerun the workflow (`gh workflow run release.yml`), it finishes what's missing. Check the result with `npm view @hyperwatch/hyperwatch dist-tags`: `latest` should be the new version.

### Setup, once

- npm trusted publishing: on npmjs.com, in the package's settings, add a trusted publisher: GitHub Actions, `hyperwatch/hyperwatch`, workflow `release.yml`.
- Optionally, in the repository's settings (Actions → General), "Allow GitHub Actions to create and approve pull requests", so that step 1 opens the pull request itself.

## After the release

Update the projects that depend on Hyperwatch. For a major version, their `^` range won't pick it up automatically: bump the range explicitly (for example `^5.0.0`).

## Note on 4.3.1

The `v4.3.1` tag is not on `main`. `main` has rebased copies of that release (`caff220 version 4.3.1`), and a few PRs that come before `caff220` on `main` (#545, #556, #557, #558) were never in the published 4.3.1: they first shipped in 5.0.0. From 5.0.0 on, tags are on `main` and `git log vX.Y.Z..origin/main` is reliable.
