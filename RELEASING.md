# Releasing

How to release a new version of `@hyperwatch/hyperwatch`.

Releases are made by GitHub Actions workflows, from `main` only: anything not merged into `main` doesn't ship.

- [**Refresh the published lists**](.github/workflows/refresh.yml) (run by hand, before a release) opens the pull request that updates the address lists and keys operators publish.
- [**Prepare a release**](.github/workflows/release-prepare.yml) (run by hand) opens the pull request `version X.Y.Z`: `package.json` and `package-lock.json` bumped, and the release notes drafted in `CHANGELOG.md`.
- [**Release**](.github/workflows/release.yml) (on each push to `main`) releases `package.json`'s version when it isn't released yet: the checks, `npm publish`, an annotated tag `vX.Y.Z` on the last commit of the version pull request, and a GitHub release with its notes.

`node scripts/release.js` holds what they share (`changes`, `prepare`, `verify`, `pack`, `notes`, `data-changes`: see its header). It never commits, tags, pushes or publishes.

## Before you start: refresh the published ranges and keys

Several identities are checked against address lists their operators publish (`src/data/*-ips.json`), and Web Bot Auth signatures against the agents' keys (`src/data/webbotauth-keys.json`). Refresh them before each release, so it ships with current ranges and keys:

```bash
gh workflow run refresh.yml
```

The [**Refresh the published lists**](.github/workflows/refresh.yml) workflow runs `scripts/fetch-ips.js` and `scripts/fetch-webbotauth-keys.js`, then `npm test`, and opens (or updates) the pull request "Refresh the published IP ranges", "Refresh the Web Bot Auth keys" or both, from the branch `refresh-published-lists`. The pull request gives a table of the ranges and keys added and removed per file (`node scripts/release.js data-changes`), and the lists or agents that couldn't be fetched, which keep their current files: retry later, or find out why, rather than release with a list that wasn't refreshed. If nothing changed, the run says so and opens nothing.

Some lists have no updater: their operators publish them only inside a page, a table or a PDF, and a parser per page would break silently when the page changes. Compare them with their source too, by hand or by asking an agent to read each source below and update the file, then review the diff:

- `amazonbot-ips.json`, `amazon-searchbot-ips.json`, `amazon-user-ips.json`: the JSON embedded in Amazon's pages for [Amazonbot](https://developer.amazon.com/amazonbot/ip-addresses/), [Amzn-SearchBot](https://developer.amazon.com/amazonbot/searchbot-ip-addresses/) and [Amzn-User](https://developer.amazon.com/amazonbot/live-ip-addresses/).
- `amazon-quick-ips.json`: the table of [Amazon Quick's regions](https://docs.aws.amazon.com/quick/latest/userguide/regions.html).
- `daumbot-ips.json`: [daumbot.json](https://webmaster.daum.net/crawler/daumbot.json). Its server doesn't send its intermediate certificate, so Node can't fetch it, but curl can: `curl -s https://webmaster.daum.net/crawler/daumbot.json`.
- `360spider-ips.json`: the PDF linked from [360's spider page](https://www.so.com/help/spider_ip.html), one address per line (`pdftotext` reads it).
- `dataforseo-ips.json`: the IPv4 and IPv6 subnets written under "IPv4:" and "IPv6:" on [DataForSEO's bot page](https://dataforseo.com/dataforseo-bot).
- `marginalia-ips.json`: the addresses written after "IP address:" under "Crawler Fingerprint" on [Marginalia's page for webmasters](https://www.marginalia.nu/marginalia-search/for-webmasters/) (`193.183.0.162-174` as CIDRs).

Do it on the refresh branch (or a branch of your own when nothing else changed), and add what changed to the pull request's table.

Merge the refresh pull request before step 1; its line lands under **Identities** in the drafted notes.

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

Merging starts the Release workflow (`gh run watch`). From the last commit the version pull request put on `main` (whatever the merge method; the version commit itself if it was pushed without a pull request), it:

1. checks the notes (`release.js verify`), then runs `npm test`, `lint`, `prettier:check`, `type:check`, `types:test`, `depcheck`, and checks the package contents (`release.js pack`: only what the `files` whitelist of `package.json` allows, plus what npm always adds);
2. publishes to npm, with [trusted publishing](https://docs.npmjs.com/trusted-publishers) (no token);
3. tags the commit `vX.Y.Z`;
4. creates the GitHub release `X.Y.Z`, with the version's section of `CHANGELOG.md` and a link to npm.

Each step is skipped when already done: if one fails, fix the cause and rerun the workflow on `main` (`gh workflow run release.yml`; from another branch it does nothing), it finishes what's missing. Check the result with `npm view @hyperwatch/hyperwatch dist-tags`: `latest` should be the new version.

### Setup, once

- npm trusted publishing: on npmjs.com, in the package's settings, add a trusted publisher: GitHub Actions, `hyperwatch/hyperwatch`, workflow `release.yml`.
- Optionally, in the repository's settings (Actions → General), "Allow GitHub Actions to create and approve pull requests", so that the refresh and prepare workflows open their pull requests themselves.

The refresh and prepare workflows push with the workflow's token, which starts no workflow: they run CI on their branch themselves (`ci.yml` accepts `workflow_dispatch`), for the checks the pull request needs.

## After the release

Update the projects that depend on Hyperwatch. For a major version, their `^` range won't pick it up automatically: bump the range explicitly (for example `^5.0.0`).

## Note on 4.3.1

The `v4.3.1` tag is not on `main`. `main` has rebased copies of that release (`caff220 version 4.3.1`), and a few PRs that come before `caff220` on `main` (#545, #556, #557, #558) were never in the published 4.3.1: they first shipped in 5.0.0. From 5.0.0 on, tags are on `main` and `git log vX.Y.Z..origin/main` is reliable.
