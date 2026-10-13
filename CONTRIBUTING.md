# Contributing to Kaiten SDK for JavaScript

Thank you for contributing to the Kaiten JavaScript SDK.

This project is licensed under the Apache License, Version 2.0.

## Developer Certificate of Origin

Kaiten uses the Developer Certificate of Origin 1.1 (DCO) for contributions.

Every commit must include a `Signed-off-by` trailer matching the commit author.

Use:

```bash
git commit -s -m "Describe your change"
```

This produces:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

`git commit -s` is a **DCO sign-off**: it certifies the contribution under
[DCO.md](./DCO.md). `git commit -S`, with a capital S, is a **cryptographic
commit signature** made with a GPG or SSH key. They are not the same thing, and
the sign-off is what this project requires. There is nothing to install.

### Fixing a missing sign-off

A check named **DCO** verifies every commit of every pull request, and it is the
final word. If it fails, it names the commits to fix.

For the latest commit:

```bash
git commit --amend --signoff --no-edit
git push --force-with-lease
```

For several commits, sign off every commit of your branch at once:

```bash
git rebase --signoff origin/main
git push --force-with-lease
```

## Contribution rules

Please:

- keep pull requests focused;
- add or update tests when behavior changes;
- update documentation when relevant;
- do not include secrets, customer data, or confidential information;
- do not submit code or assets that you do not have the right to contribute;
- preserve required third-party license and attribution notices.

Accepted contributions are contributed under Apache-2.0.

## Security

Do not report unpatched vulnerabilities in public issues.

See [SECURITY.md](./SECURITY.md).

## Setup

You need Node.js 24 (see `.node-version`), pnpm 12 (the root `packageManager`
field; Corepack provides it) and the [Vite+](https://viteplus.dev) CLI, `vp`, which
wraps install, build, test, lint and format.

```bash
vp install
vp run -r build
```

> Everything installs from npm, with no token, and the contract checks read what
> the API publishes from npm too (see [API contracts](#api-contracts)).

## Build before you check

The packages resolve each other through their built `dist/`, so rebuild upstream
before checking or testing a downstream package:

```bash
vp run -r build
vp check
vp run -r test
```

`packages/react` is tested against the build of `@kaitencloud/client`,
`packages/react-ui` against the build of `@kaitencloud/react`, and `examples/node`
against the builds of `@kaitencloud/client` and `@kaitencloud/server`. react-ui's
`test` also runs its Storybook stories in Chromium, which Playwright installs with
`vp run test:browsers:install` in `packages/react-ui`. `pnpm run ready` runs the
whole sequence, build first, with the contract and release checks; its GraphQL drift
check needs a checkout of kaiten next to this repository, or a schema file named by
`KAITEN_GRAPHQL_SCHEMA`.

The components have a Storybook playground: `vp run @kaitencloud/react-ui#storybook`.

## What CI runs

- **lint**: the license headers, formatting, lint and types (`vp check`), version
  invariants, token contrast, and the GraphQL operations against the schema snapshot.
- **build**: every package and example, the license and notice files and the
  manifest of each tarball, publint and attw on the React tarballs, the bundle-size
  budgets, and that no browser bundle carries a token, the name of a secret variable
  or code of `@kaitencloud/server`.
- **test**: the tests of every package and of the Node example, the React coverage
  ratchets, Storybook, visual regression and layout invariants, in the Playwright
  container, those of the conformance example (which skip the live suite and rehearse
  its code), and those of the repository's own scripts (`vp test run scripts`).
- **storefront-e2e**: the storefront example (`examples/storefront`) in Chromium: its pricing
  table, its checkout and its customer portal, against a stand-in for Kaiten that runs in the
  same process, so it needs no stack and no secret. A card saved on a provider's page, a declined
  card and a 3-D Secure challenge are played by the stand-in; the example's `live` project
  runs the paths that need no card against a Kaiten of your own, and is not run in CI. Not
  required to merge. [`examples/storefront`](examples/storefront) says what it proves.
- **react-18-compat**: the React packages' unit tests against React 18, their peer
  floor.
- **compat-1.0**: code written against `@kaitencloud/client` 1.0.0 compiles against
  the tarball npm serves for 1.0.0 and against the one this tree would publish, and
  every name 1.0.0 exports, from the client and from `@kaitencloud/server`, is still
  exported, a value still a value, except the client's `MeterType`, removed on
  purpose in 1.1.0 (`REMOVED_SINCE_1_0`). Not required to merge, because it reads
  the npm registry.
- **release-dependencies**: the shape of what a release would publish, with npm's own
  dry run, and, once the React packages are in the tree, that they compile against
  the lowest client their range allows. Advisory: it is meant to fail while the client
  a React package needs is not on npm yet, and it blocks in the release procedure.
- **Conformance** (its own workflow, `conformance.yml`, run by hand or on a pull
  request): a customer's whole journey through a running Kaiten with the two packages
  alone, each answer held to the API contract. It reads the stack it runs against from the
  repository's secrets and skips without them. [`examples/conformance`](examples/conformance)
  says what it needs.

Four of these are scripts you can run yourself, after `vp run -r build`:
`pnpm run check:no-secrets`, `pnpm run check:compat-1.0`,
`pnpm run check:release-dependencies` and `pnpm run test:scripts`.

Visual baselines are Linux screenshots. When a change moves pixels on purpose,
regenerate them with the **Update visual baselines** workflow rather than locally:
`vp run baselines:update` dispatches it on your pushed branch.

## License headers

Every JavaScript and TypeScript file opens with the project's license notice, after
its `#!` line if it has one:

```ts
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0
```

`node scripts/check-license-headers.mjs` checks it, generated files included, and
lists the files that lack it; `--fix` adds it to hand-written ones. The generators
write it into the code they emit, so a generated file gets it by being regenerated.

## API contracts

`contracts/openapi.yaml` and `contracts/schema.graphql` are snapshots of what the
Kaiten API publishes, and the generated clients come from them:

```bash
vp run sync-openapi
(cd packages/client && vp run generate)
(cd packages/server && vp run generate)
(cd packages/client && vp run generate-graphql)
vp check --fix packages/client/src/core/generated packages/server/src/generated
```

Never edit a snapshot or generated code by hand. The contract-drift workflow
compares both snapshots with the published contracts. A drift is fixed with the
commands above for the OpenAPI contract, and with `vp run sync-graphql-schema`, then
`vp run generate-graphql` in `packages/client`, for the GraphQL schema.
Both contracts are required: a drift check that cannot read one fails. Locally, the
OpenAPI check fetches the published contract from npm, with no token, and the
GraphQL check reads a checkout of kaiten next to this repository, or the schema file
`KAITEN_GRAPHQL_SCHEMA` names.

## Upgrading Vite+

Vite+ decides the versions of Vite, Vitest and the `@vitest/*` packages:
`vite-plus` depends on an exact Vitest, and the `vite` catalog entry aliases its
core. Dependabot leaves them alone and opens a pull request for `vite-plus` by
itself, which fails `lint` until the others follow. To finish it, on its branch:

```bash
vp upgrade <version>    # the global vp, at the release the pull request brings
vp migrate              # re-pins vite-plus, the vite alias and vitest to that release
vp toolchain vitest     # the Vitest that release bundles
vp install
node scripts/check-version-invariants.mjs
```

Set every `@vitest/*` catalog entry to the Vitest that `vp toolchain` reports; the
invariant check fails until they match. Run `vp migrate` only after `vp upgrade`:
it re-pins to the release of the global `vp`, so an older one moves the project
back. pnpm installs nothing published less than a day ago, so a fresh release
needs its packages in `minimumReleaseAgeExclude`, in `pnpm-workspace.yaml`.

## Changesets and releases

Every pull request that changes a package includes a changeset:

```bash
pnpm changeset          # pnpm changeset --empty for a change that does not ship
```

The packages follow semantic versioning. `patch` is a fix with no API impact,
`minor` a feature that breaks nothing, and `major` a breaking change, which says
BREAKING in its summary.

On `main`, the Release workflow keeps a **chore: version packages** pull request up
to date: it bumps versions and writes the changelogs. Merging it publishes the
bumped packages to npm, tags them and creates the GitHub releases. The publish uses
npm trusted publishing, so no npm token is stored anywhere.

### The Kaiten version the READMEs name

The billing features need a Kaiten release that serves billing's routes. The root README and
those of the four packages each say which, in a "Kaiten version" section whose first sentence
is the same everywhere, and `vp test run scripts` fails when they differ. While no Kaiten
release carries billing, the sentence says so. The pull request of the first release that
needs a Kaiten with billing replaces "the first Kaiten release with billing" by that Kaiten's
version, in all five.

### The React packages are private until billing ships

`@kaitencloud/react` and `@kaitencloud/react-ui` are `"private": true` in their
`package.json` until Kaiten billing ships, and nothing publishes them before that.
Changesets neither versions nor publishes a private package: a change to them needs
no changeset, and a changeset that names them bumps nothing. Their changelogs are
written by hand until their first release. CI still builds them, tests them, checks
their bundle size and the shape of the tarball they will ship, so making them public
is a change of two lines.

Make them public together. `node scripts/check-version-invariants.mjs` fails when a
public package depends on a private one, and Changesets itself refuses a tree where
`react-ui` would be released without `react`.

npm accepts a trusted publisher only on a package that already exists, so their
first version is published by hand, once, by a maintainer of the `@kaitencloud`
npm scope:

1. On a branch from `main`, delete `"private": true` from both `package.json`
   files, check that each `CHANGELOG.md` describes the version in its
   `package.json` (1.0.0 today), and add an empty changeset
   (`pnpm changeset --empty`).
   The READMEs of the packages already on npm say nothing about these two until they
   exist there: add the sentence to `packages/client/README.md` that names
   `@kaitencloud/react` and `@kaitencloud/react-ui` as built on the client, and name
   both in the Node 22.12+ note of `packages/server/README.md`.
2. Build, check and pack both packages on that branch, as the Release workflow
   does, so the tarballs carry the catalog's real ranges. The release-dependencies
   check blocks here: it compiles what `@kaitencloud/react` imports from the client
   against the lowest client its range allows, fetched from npm, so the client that
   carries those exports has to be published first and be the one this branch
   builds with:

   ```bash
   vp run -r build
   node scripts/check-published-shape.mjs
   node scripts/check-release-dependencies.mjs
   mkdir -p /tmp/kaiten-react-release
   (cd packages/react && pnpm pack --pack-destination /tmp/kaiten-react-release)
   (cd packages/react-ui && pnpm pack --pack-destination /tmp/kaiten-react-release)
   ```

3. Logged in to npmjs.com, publish `@kaitencloud/react` first, then
   `@kaitencloud/react-ui`, from those tarballs:
   `npm publish /tmp/kaiten-react-release/kaitencloud-react-1.0.0.tgz`. If your
   `.npmrc` maps `@kaitencloud` to another registry, add
   `--@kaitencloud:registry=https://registry.npmjs.org/`.
4. On npmjs.com, add this repository's `release.yml` as the trusted publisher of
   each package.
5. Merge the branch. npm already has 1.0.0, so the Release workflow has nothing
   to publish for them, and publishes their later versions itself.

## Pull requests

For substantial features, architectural changes, or changes to public APIs,
please open an issue or discussion first so the approach can be aligned before
significant implementation work begins.

Make sure `vp check` and the affected tests pass. A pull request should explain:

- what changed;
- why it changed;
- how it was tested;
- any compatibility or migration impact;
- any new third-party dependency or attribution requirement.

All required CI checks, including the DCO check, must pass before merge.

## Employer or organization-owned contributions

If your employer or another organization owns intellectual-property rights in
your work, you are responsible for confirming that you are authorized to
contribute it to Kaiten under Apache-2.0 and to make the DCO certification.

The DCO does not override your employment agreement or another party's
intellectual-property rights.

## Third-party dependencies and copied material

Before introducing a dependency or copying third-party code, assets, examples,
schemas, documentation, or generated material, verify that its license is
compatible with the way Kaiten is distributed.

Preserve all required copyright, license, attribution, and NOTICE information.
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) says when an entry belongs
there. Each published package ships a copy of it, and the build fails when a copy
differs from the root file. A test (`vp test run scripts`) also holds it against the icons
and the primitives `@kaitencloud/react-ui` copies, so that a new one is a reason to read it.

Do not assume that material found publicly online is available for inclusion in
an Apache-2.0 project.

## AI-assisted contributions

You remain responsible for the provenance and licensing of all material you
submit, including material created with AI-assisted development tools.

Do not submit generated code or content when you cannot reasonably establish
that you have the right to contribute it under the project's terms.

## Code of Conduct

Participation in the Kaiten community is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions

For contribution questions, open a GitHub Discussion or issue in the relevant
Kaiten repository.
