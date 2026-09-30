# Contributing

Thanks for helping improve the Kaiten SDK for JavaScript. This guide covers the
local setup, the checks CI runs, and how a change gets released.

Unless a repository or component explicitly states otherwise, Kaiten's
open-source code is licensed under the
[Apache License, Version 2.0](LICENSE).

By submitting a contribution for inclusion in Kaiten, you agree that the
contribution is submitted under the terms of the project's Apache-2.0 license,
consistent with Section 5 of that license, and you certify your contribution
under the [Developer Certificate of Origin 1.1](#developer-certificate-of-origin)
("DCO").

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

`examples/node` is tested against the builds of `@kaitencloud/client` and
`@kaitencloud/server`. `pnpm run ready` runs the whole sequence, build first, with
the contract and release checks; its GraphQL drift check needs a checkout of kaiten
next to this repository, or a schema file named by `KAITEN_GRAPHQL_SCHEMA`.

## What CI runs

- **lint**: formatting, lint and types (`vp check`), version invariants, and the
  GraphQL operations against the schema snapshot.
- **build**: every package, the license and notice files and the manifest of each
  tarball, and the client's bundle-size budget.
- **test**: the tests of every package and of the Node example.

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

## Pull requests

For substantial features, architectural changes, or changes to public APIs,
please open an issue or discussion first so the approach can be aligned before
significant implementation work begins.

Keep a pull request to one concern, and make sure `vp check` and the affected
tests pass. A pull request should explain:

- what changed;
- why it changed;
- how it was tested;
- any compatibility or migration impact;
- any new third-party dependency or attribution requirement.

For every contribution:

- add or update tests when behavior changes;
- update documentation when relevant;
- do not include secrets, credentials, customer data, or confidential material;
- do not submit code, documentation, assets, data, or other material that you
  do not have the right to contribute;
- identify third-party material and preserve any required license or attribution
  notices.

All required CI checks, including the DCO check, must pass before merge.

## Developer Certificate of Origin

Kaiten uses the Developer Certificate of Origin 1.1 rather than a Contributor
License Agreement.

The DCO is a lightweight certification that you wrote the contribution, or
otherwise have the right to submit it under the project's open-source license.

The complete DCO text is available in [DCO.md](DCO.md).

Each commit in a pull request must contain a `Signed-off-by` trailer matching
the commit author.

The easiest way to add it is:

```bash
git commit -s -m "Describe your change"
```

This creates a trailer such as:

```text
Signed-off-by: Jane Doe <jane@example.com>
```

The `-s` flag is a DCO sign-off. It is different from cryptographically signing
a commit with `git commit -S`.

### Fixing a missing sign-off

If the most recent commit is missing a sign-off:

```bash
git commit --amend --signoff --no-edit
git push --force-with-lease
```

For several commits, `git rebase --signoff <base>` adds the trailer to every
commit of the branch after `<base>`; push the result with `--force-with-lease`.
An interactive rebase that amends the affected commits works too, as do the
remediation instructions supplied by the repository's DCO check.

Do not add another person's sign-off unless you are authorized to certify the
contribution on their behalf under the DCO.

## Employer or organization-owned contributions

If your employer or another organization owns intellectual-property rights in
your work, you are responsible for confirming that you are authorized to
contribute it to Kaiten under Apache-2.0 and to make the DCO certification.

The DCO does not override your employment agreement or another party's
intellectual-property rights.

## Contribution licensing

Kaiten follows a license-in / license-out model for the open-source project:

- the Kaiten open-source core is distributed under Apache-2.0;
- accepted contributions to that core are contributed under Apache-2.0;
- contributors retain any copyright they hold in their original contributions;
- KAITEN INC and all other recipients receive the rights granted by Apache-2.0.

Kaiten may also offer hosted services, support, integrations, or separate
commercial software. Those offerings do not change the Apache-2.0 license
applicable to the open-source Kaiten code.

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

## Security issues

Do not disclose an unpatched vulnerability through a public issue.

Please follow [SECURITY.md](SECURITY.md).

## Code of Conduct

Participation in the Kaiten community is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Questions

For contribution questions, open a GitHub Discussion or issue in the relevant
Kaiten repository.
