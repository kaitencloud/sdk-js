# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Each `*.md` file in here describes one upcoming version bump for one or more packages of this monorepo. The files are created by contributors, consumed when a release is cut, and never edited by hand.

You should not need to read this file in normal use — the high-level workflow lives in [`CONTRIBUTING.md`](../CONTRIBUTING.md#changesets-and-releases). What follows is the local reference if you need to troubleshoot or do something out of the ordinary.

## How a changeset is created

```bash
pnpm changeset
```

The CLI walks you through:

1. **Which packages does this change?** — pick one or several of the packages under `packages/`.
2. **Bump type for each one** — `patch`, `minor`, or `major`. See the bump conventions in [`CONTRIBUTING.md`](../CONTRIBUTING.md#changesets-and-releases).
3. **Summary** — one or two sentences. This text lands verbatim in the package's `CHANGELOG.md`, so write it for the consumer, not for git history.

The CLI then writes a file like `funny-cats-jump.md` in this folder:

```md
---
"@kaitencloud/client": minor
"@kaitencloud/server": patch
---

Add `getCatalog()` to the client and fix the server's retry delay.
```

Commit it alongside the code change in the same PR.

## How a changeset is consumed

You don't run `pnpm run version-packages` or `changeset publish` locally — the **Release** GitHub Action does it. See [`.github/workflows/release.yml`](../.github/workflows/release.yml).

On every push to `main`, the action looks at the contents of this folder:

- **If there is at least one `*.md` file**, it opens (or refreshes) a pull request titled `chore: version packages`. That PR applies all pending changesets: it bumps versions, writes `CHANGELOG.md` entries, and deletes the consumed files from this folder.
- **If this folder is empty** (except for `README.md` and `config.json`), it publishes to npm every package whose version npm does not have yet.
- **If it holds only empty changesets**, it does neither.

Merging the `chore: version packages` PR is therefore the act of cutting a release.

## Config

[`config.json`](./config.json) holds the Changesets settings. The notable ones:

- `"changelog": ["@changesets/changelog-github", { "repo": "kaitencloud/sdk-js" }]` — generates changelog entries with links to PRs and contributor mentions.
- `"access": "public"` — the packages are public on npm.
- `"commit": false` — the workflow handles the commits via `changesets/action`, not the CLI.
- `"baseBranch": "main"` — the branch the release PR targets.

## Common situations

**My PR does not need a release.** Run `pnpm changeset --empty` and commit the empty changeset. The CI `changeset` check will pass, and nothing will be versioned or published.

**I picked the wrong bump type / wrote a typo.** Edit the generated `.md` file directly before the PR is merged. The frontmatter is plain YAML, the body is plain Markdown.

**Several PRs are merged before the release PR is.** That's fine — the release PR aggregates every pending changeset until it is merged. The version bumps and changelog entries compound naturally.

**I want to ship right now.** Just merge the open `chore: version packages` PR. If none is open, push (or merge) a PR with a changeset and one will appear.

## More

Full documentation: <https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md>
