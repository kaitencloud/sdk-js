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

> Everything installs from npm, with no token. CI compares contracts with the
> published npm artifacts by default; coordinated feature PRs may name a reviewed
> immutable companion commit (see [API contracts](#api-contracts)).

## Build before you check

The packages resolve each other through their built `dist/`, so rebuild upstream
before checking or testing a downstream package:

```bash
vp run -r build
vp check
vp run -r test
```

`examples/node` is tested against the builds of `@kaitencloud/client` and
`@kaitencloud/server`. `pnpm run ready` runs the whole sequence, build first, with
the contract and release checks; its GraphQL drift check needs a checkout of kaiten
next to this repository, or a schema file named by `KAITEN_GRAPHQL_SCHEMA`.

## What CI runs

- **lint**: the license headers, formatting, lint and types (`vp check`), version
  invariants, and the GraphQL operations against the schema snapshot.
- **build**: every package, the license and notice files and the manifest of each
  tarball, and the client's bundle-size budget.
- **test**: the tests of every package and of the Node example.

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

### Coordinated, unpublished API changes

A feature PR can validate against a companion Kaiten commit **without publishing**
contracts just to pass CI. `.github/kaiten-contract-source.json` records the fixed
repository `kaitencloud/kaiten`, its full lowercase 40-hex `commit`, and the SDK
feature `headBranch`. The current AI credits source is Kaiten PR #66,
`feat/ai-credits`, at `51224227aaad2c3d2a990440ff48c66db6fbd8e6`; this is **not** a
claim of compatibility with npm latest (which currently has 162 OpenAPI operations
versus this feature's 182).

The contract-drift workflow honors this file **only** for a `pull_request` whose
head branch exactly matches `headBranch`. Other PR branches, pushes to `main`, and
scheduled checks still fetch both npm `latest` artifacts. No environment variable
or absent artifact silently skips a comparison. Invalid overrides, failed fetches,
missing contracts, and symlinks fail closed. The jobs fetch an immutable Git tree
and read only the OpenAPI blob and gqlgen schema fragments: no companion checkout,
install, build, or code execution. Logs and the job summary name the actual source,
with file hashes in the fetch output. Existing OpenAPI byte-equality, GraphQL
canonical equality **and** shipped-operation validation all still run.

When companion schemas change, update the pin to the reviewed commit and sync /
regenerate from that same source. For a local checkout of that exact commit:

```bash
KAITEN_OPENAPI=/path/to/kaiten/app/openapi.yaml node scripts/check-openapi-drift.mjs
KAITEN_PATH=/path/to/kaiten node scripts/check-graphql-drift.mjs
```

Review the pin with both PRs. Before landing/releasing the SDK, matching contracts
must be published through the ordinary Kaiten release process, then remove the
feature override and rerun the default published-contract checks. A green feature
PR check is evidence of compatibility with the named companion commit only; it
never proves the new API is published or deployed. Main and weekly checks remain
red until the published contracts really agree. Do not add tags or publish packages
just to make a coordinated development check green.

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
differs from the root file.

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

## AI wrapper compatibility

AI integrations are separate server-side packages with optional provider peers.
Provider SDKs are development-only dependencies for API/type compatibility tests;
wrappers do not bundle or re-export them. Agent development dependencies include
native CLI distributions but tests must never launch them or use provider auth.
Installed compatibility versions are OpenAI 7.38.0, Anthropic 0.135.0, AI 7.0.143,
Claude Agent 0.3.303, Codex 0.163.0 and Copilot 1.0.22. Peer ranges intentionally
bound the public surface; preview agent 0.x peers are patch-range bounded.
Fixtures use synthetic usage and custom fetch/model doubles, never live providers.
See each integration README for explicit unavailable preflight guarantees.
No extra third-party attribution is required for these externally resolved peers:
no provider material is copied, bundled or distributed by the wrapper packages.

Copilot pulls `koffi@3.2.1`. Its native lifecycle script is explicitly **denied**
with `allowBuilds.koffi: false`, not approved or left undecided. Copilot imports in
the observer and its tests are type-only; tests use synthetic events and never
start the Copilot runtime. These compatibility checks need no native Koffi build.
This repository's policy does not configure a consumer's own Copilot installation.

Use the normal locked install and dependency-order verification, as CI does:

```bash
pnpm install --frozen-lockfile
vp run -r build
vp check
vp run -r test
```

Do not run `pnpm approve-builds` or approve native scripts merely to check wrappers.
The existing esbuild approval is unchanged.
