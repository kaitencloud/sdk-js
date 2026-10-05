<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Repo gotchas

- **Build before you check or test, in dependency order.** The packages resolve each
  other through their built `dist/`, never their sources, so any verification run
  before a rebuild compares new source against the _previous_ build and passes on
  stale types:

  ```
  vp run -r build && vp check && vp test
  ```

  `packages/react` is checked and tested against the **built `dist/`** of `client`,
  `packages/react-ui` against that of `react`, and `examples/node` and
  `examples/react-vite` against those of the packages they use (their `exports` only
  point at `dist/`), so every hop needs the rebuild. A regenerated contract is the
  usual way to get caught: the type errors it causes stay invisible until the next
  build.

  `vp test` at the root runs every package's unit suites. `vp run -r test`, which CI
  runs, also runs react-ui's Storybook stories in Chromium.

- The API contracts live in `contracts/`: `openapi.yaml` feeds the generated REST clients of `@kaitencloud/client` and `@kaitencloud/server` (`vp run generate` in each package), and `schema.graphql` feeds the client GraphQL codegen (`packages/client/codegen.ts`, `vp run generate-graphql`). Both are committed snapshots of what the Kaiten API publishes; never edit them or the generated code by hand. `node scripts/check-graphql-drift.mjs` asserts that the shipped operations in `documents.ts` still validate against the snapshot (always hard-fails), and that the snapshot matches the API's schema, which it must be able to read: `KAITEN_GRAPHQL_SCHEMA`, or `KAITEN_PATH` for a local checkout of kaiten (default `../kaiten`). `--operations-only` runs the first check alone.
- **Every JavaScript and TypeScript file opens with the license header**, two `//`
  lines (after a `#!` line, if any). `node scripts/check-license-headers.mjs` fails
  `lint` on a file without it and `--fix` adds it to hand-written files; the
  generators write it into generated ones, so regenerate those instead.
- `packages/client/tests/compat/consumer-1.0.ts` is an application written against
  `@kaitencloud/client` 1.0.0. `node scripts/check-compat-1.0.mjs` compiles it against
  the published 1.0.0 and against the build of this tree. When it stops compiling, the
  change under test is breaking: fix the change, never the fixture.
- A script that reads npm names the registry itself (`scripts/lib/npm-package.mjs`),
  the scope included: a user-level mapping of `@kaitencloud` to another registry
  outranks `--registry`. Do the same in a new one, and unpack tarballs rather than
  install them, so that no package's script runs.
- The tests of the scripts live in `scripts/tests` and run from the root with
  `vp test run scripts`, after the build.
- **Vite+ owns the Vite and Vitest versions.** Never bump `vite`, `vitest` or a
  `@vitest/*` package by itself: upgrade `vite-plus` as CONTRIBUTING.md describes, and
  `node scripts/check-version-invariants.mjs` checks that the pins agree.
- `@kaitencloud/react-ui` inlines the design tokens of `@kaitencloud/theme`, a published package pinned in its `devDependencies`. Token values are not edited in this repository.
- react-ui's visual baselines (`tests/visual/__screenshots__/*-linux.png`) are rendered in CI's Playwright container, never on a developer machine: `vp run baselines:update` dispatches the workflow that regenerates them.
