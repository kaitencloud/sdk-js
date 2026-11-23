---
name: sdk-js-ci-parity
description: Reproduce this repository's CI on your machine before you push, open or update a pull request, or after a merge, a rebase or a dependency bump. Picks the CI jobs a change can break, runs them in CI's order on a fresh build, covers the jobs `pnpm run ready` leaves out (coverage ratchets, layout invariants, storefront end-to-end, React 18, generated SDK, release projection), and says how to read a red result that is not the change's fault (stale build, missing Playwright browser, a port another checkout holds, upstream contract drift). Also how to commit through the pre-commit hook with the DCO sign-off.
---

# Reproduce CI locally

`.github/workflows/ci.yml` is the reference. CONTRIBUTING.md, "What CI runs", says
what each job proves; this skill says how to replay them here and how to read the
result. When this file and `ci.yml` disagree, `ci.yml` wins: fix this file.

The `main` ruleset requires `lint`, `build`, `test` and `DCO`. `test` passes only
when `test-unit`, `test-visual` and `test-layout` all passed. The other jobs are not
required, but a reviewer reads them.

## 1. Start from a clean tree

- Work in a worktree cut from an up-to-date `origin/main` (or from the PR's head),
  never in a clone that sits on another branch:
  `git fetch origin`, then
  `git worktree add -b <branch> .claude/worktrees/<name> origin/main`.
  Before creating one, run `git worktree list` and `gh pr list`: another session or
  a teammate may already be on the same change.
- Install as CI does: `pnpm install --frozen-lockfile`. If your user-level `.npmrc`
  maps the `@kaitencloud` scope to another registry, the install fails on a
  `@kaitencloud/*` dev dependency (for example a "minimum release age" or "version
  not present" error) and leaves `node_modules` half updated. Install from the public
  registry, as CI does, without touching any `.npmrc`:
  `NPM_CONFIG_USERCONFIG=/dev/null pnpm install --frozen-lockfile`.
- **Build before anything else**: `vp run -r build`. Packages resolve each other
  through their built `dist/`, so every check run before a rebuild compares new
  source with the previous build and can pass on stale types.
- `vp run` replays cached results for packages it judges unchanged. For the final
  proof before a push, build with `vp run --no-cache -r build`.

## 2. Pick the jobs your change can break

| You changed                                       | Run at least                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Anything                                          | lint, build, the changeset check                                                                 |
| `packages/client`, `packages/server`              | test-unit, compat-1.0, release-dependencies; generated-sdk if `contracts/` or a generator moved  |
| `packages/react`                                  | test-unit (with its coverage ratchet), react-18-compat, release-dependencies, the bundle budgets |
| `packages/react-ui`                               | test-unit (Storybook included), test-layout, react-18-compat; test-visual if pixels can move     |
| `examples/storefront`                             | storefront-e2e, and its unit tests (`vp test` in the example)                                    |
| `scripts/`                                        | `vp test run scripts`, and the job that runs the script you touched                              |
| `pnpm-lock.yaml`, `vite-plus`, `@playwright/test` | everything, and reinstall the Playwright browsers (section 5)                                    |

## 3. The jobs, in CI's order

Run from the worktree root unless a directory is named, after the build of
section 1. Each block is one CI job.

**lint**

```bash
node scripts/check-license-headers.mjs
vp check
node scripts/check-version-invariants.mjs
node scripts/check-token-contrast.mjs
node scripts/check-graphql-drift.mjs --operations-only
```

`vp check --fix <files>` formats and fixes only the files you name.
`node scripts/check-license-headers.mjs --fix` adds the header to hand-written files;
regenerate generated ones instead.

**build**

```bash
node scripts/check-published-shape.mjs
node scripts/check-bundle-size.mjs
node scripts/check-no-secrets-in-example-build.mjs
```

**test-unit**

```bash
vp run -r test            # every package; react-ui's runs its Storybook stories in Chromium
vp test run scripts
(cd packages/react && vp run test:unit:coverage)
(cd packages/react-ui && vp run test:unit:coverage)
```

`vp test` at the root runs the unit suites only; `vp run -r test`, which CI runs,
adds react-ui's Storybook project. The coverage commands are ratchets: their
thresholds are flags of the `test:unit:coverage` scripts, and they fail when
coverage drops.

**test-layout** (the slowest job on CI's runner; it runs on every worker the
machine has, so a few minutes on a recent laptop)

```bash
cd packages/react-ui && vp run build-storybook && vp run test:layout
```

**test-visual**: not reproducible on a developer machine. The baselines
(`tests/visual/__screenshots__/*-linux.png`) are rendered in CI's Linux Playwright
container, and a local run compares macOS or Windows pixels with them. When a change
moves pixels on purpose, push the branch and run `vp run baselines:update`, which
dispatches the workflow that regenerates them (CONTRIBUTING.md, "What CI runs").

**storefront-e2e**

```bash
cd examples/storefront && pnpm run test:e2e
```

Use `pnpm run`, not `vp run`: the live project reads shell variables `vp run`
hides. The five `live` tests skip without a Kaiten of your own; CI does not run
them either. See section 5 before trusting a red run: the stand-in server's port
may be held by another checkout.

**react-18-compat**: do it in a throwaway copy, never in your worktree, since it
rewrites `pnpm-workspace.yaml` and the lockfile.

```bash
git clone --quiet --branch <branch> <path-to-this-repo> <scratch-dir>   # commit first, or copy your changes in
cd <scratch-dir>
node -e 'const fs=require("node:fs");const f="pnpm-workspace.yaml";const s=fs.readFileSync(f,"utf8");if(!/^overrides:$/m.test(s))throw new Error("no overrides: block");fs.writeFileSync(f,s.replace(/^overrides:$/m,"overrides:\n  react: ^18.3.1\n  react-dom: ^18.3.1"))'
NPM_CONFIG_USERCONFIG=/dev/null pnpm install --no-frozen-lockfile
node -p "require('./packages/react/node_modules/react/package.json').version"   # must print 18.x
vp run -r build
(cd packages/react && vp test run --project unit)
(cd packages/react-ui && vp test run --project unit)
```

**generated-sdk** (when `contracts/` or a generator changed): regenerate from the
committed snapshots, format, and require a clean tree.

```bash
(cd packages/client && vp run generate && vp run generate-graphql)
(cd packages/server && vp run generate)
vp check --fix packages/client/src/core/generated packages/server/src/generated packages/client/src/graphql/generated
git diff --exit-code -- contracts packages/client/src/core/generated packages/server/src/generated packages/client/src/graphql/generated
```

Syncing the snapshots themselves with a newer published contract is a change of
its own: follow CONTRIBUTING.md, "API contracts", and never fold it into an
unrelated pull request.

**compat-1.0** and **release-dependencies** (both read the npm registry)

```bash
node scripts/check-compat-1.0.mjs
pnpm run check:release-dependencies
```

**changeset** (pull requests only)

```bash
pnpm changeset status --since=origin/main
```

## 4. `pnpm run ready` and what it leaves out

`pnpm run ready` chains the build, lint, build-job checks, unit and Storybook tests,
compat-1.0, the scripts' tests and the Storybook build. Two things to know:

- It stops at the first failure, so one red step hides every later one. When it
  fails, run the remaining steps one by one from section 3 to get the whole picture.
- It runs the full contract drift checks (`check-openapi-drift.mjs`,
  `check-graphql-drift.mjs` without `--operations-only`), which compare the
  snapshots in `contracts/` with the latest contract published on npm. They turn red
  as soon as the API publishes a newer contract, whatever your change is. That is
  the separate, non-required "Contract drift" workflow, not a failure of your
  branch: the fix is a contract sync in its own pull request.

It does not run the coverage ratchets, test-layout, storefront-e2e,
react-18-compat, generated-sdk or release-dependencies. Run those from section 3
when section 2 says they apply.

## 5. Reading a red result

| Symptom                                                                                            | Likely cause                                                                                                      | What to do                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type errors that name code you did not touch, or a check passes that should not                    | stale `dist/`                                                                                                     | `vp run -r build` (or `--no-cache`) and rerun                                                                                                                                                                                       |
| Storybook, layout or storefront suites fail at launch with "Executable doesn't exist", no test run | Playwright was bumped and its browser is not installed                                                            | `vp run test:browsers:install` in `packages/react-ui`. Not a failing test                                                                                                                                                           |
| Storefront e2e: many unrelated failures, or tests you did not write                                | another checkout's `vp preview` holds port 4173 and Playwright reused it (`reuseExistingServer` is on outside CI) | `lsof -nP -iTCP:4173 -sTCP:LISTEN`, then `lsof -p <pid> \| grep cwd`. Do not stop someone else's server: run from a throwaway copy with the port changed, or with `CI=1` so the run fails loudly instead of testing the wrong build |
| Install fails on a `@kaitencloud/*` package, then the build fails                                  | user-level registry mapping for the scope                                                                         | `NPM_CONFIG_USERCONFIG=/dev/null pnpm install --frozen-lockfile`                                                                                                                                                                    |
| `openapi` or `graphql` drift red                                                                   | a newer contract is published                                                                                     | not your branch (section 4)                                                                                                                                                                                                         |
| `pnpm changeset status` fails although you wrote a changeset                                       | the changeset file is untracked                                                                                   | stage or commit it, then rerun                                                                                                                                                                                                      |
| `vp check` fails on a fresh `.changeset/*.md`                                                      | `pnpm changeset --empty` writes blank lines the formatter rejects                                                 | `vp check --fix .changeset/<name>.md`                                                                                                                                                                                               |
| `check-bundle-size.mjs` over budget                                                                | budgets keep a few hundred bytes of margin                                                                        | see below                                                                                                                                                                                                                           |
| A test fails once and passes on rerun                                                              | load-dependent timing                                                                                             | rerun the suite alone, then run it on `origin/main` before blaming the branch; report it rather than retrying until green                                                                                                           |

**Bundle budgets.** Anything added to the provider or imported from the root of
`@kaitencloud/client` can land in a dozen import scenarios at once. If the growth is
intended, raise each budget in `scripts/check-bundle-size.mjs` with a note giving the
measured size, the previous one and why, and say so in the changeset. To see what a
scenario keeps, rebuild it the way the script does (esbuild with a metafile, minified,
`process.env.NODE_ENV` defined) and read the output.

**React tests with timers** use `FAKE_TIMERS` and `settle()` from
`packages/react/tests/support/billing.tsx`: Testing Library's `waitFor` does not
advance Vitest's fake timers.

## 6. Committing

- Every commit carries the DCO sign-off: `git commit -s`. The `DCO` check is
  required (CONTRIBUTING.md, "Developer Certificate of Origin").
- The pre-commit hook (`.vite-hooks/pre-commit`) runs `vp staged`, which runs
  `vp check --fix` on the staged files and may rewrite them. To prove it rewrote
  nothing, record `git write-tree` after staging and compare it with
  `git rev-parse HEAD^{tree}` after the commit.
- The hook backs up through Git's stash and removes its own entry afterwards. The
  stash stack is shared by every worktree of the clone: never run `git stash`
  yourself, and compare `git stash list` before and after a commit.
- Each pull request that changes a package needs a changeset (`pnpm changeset`, or
  `pnpm changeset --empty` for a change that does not ship).

## 7. Report

Say which jobs you ran and which passed, which you did not run and why (not
applicable, not reproducible locally, needs a registry or a stack), and any red
result you attribute to something other than the change, with the evidence.
