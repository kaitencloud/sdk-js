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

  `examples/node` is checked and tested against the **built `dist/`** of `client` and
  `server` (their `exports` only point at `dist/`), so it needs the rebuild. A
  regenerated contract is the usual way to get caught: the type errors it causes stay
  invisible until the next build.

- The API contracts live in `contracts/`: `openapi.yaml` feeds the generated REST clients of `@kaitencloud/client` and `@kaitencloud/server` (`vp run generate` in each package), and `schema.graphql` feeds the client GraphQL codegen (`packages/client/codegen.ts`, `vp run generate-graphql`). Both are committed snapshots of what the Kaiten API publishes; never edit them or the generated code by hand. `node scripts/check-graphql-drift.mjs` asserts that the shipped operations in `documents.ts` still validate against the snapshot (always hard-fails), and that the snapshot matches the API's schema, which it must be able to read: `KAITEN_GRAPHQL_SCHEMA`, or `KAITEN_PATH` for a local checkout of kaiten (default `../kaiten`). `--operations-only` runs the first check alone.
- **Vite+ owns the Vite and Vitest versions.** Never bump `vite`, `vitest` or a
  `@vitest/*` package by itself: upgrade `vite-plus` as CONTRIBUTING.md describes, and
  `node scripts/check-version-invariants.mjs` checks that the pins agree.
