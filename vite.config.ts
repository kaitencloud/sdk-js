import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,css,md,yml,yaml}": "vp check --fix",
  },
  fmt: {
    // `contracts/` holds verbatim copies of the API's contracts: `openapi.yaml`
    // (`vp run sync-openapi`) and `schema.graphql`, printed in a canonical form
    // (`node scripts/sync-graphql-schema.mjs`). Keeping them byte-identical to
    // their source is what makes the drift checks reliable diffs — formatting
    // them would make every sync look like a change. Treat them like the
    // generated clients (lint-ignored below): synced artifacts, not
    // hand-authored source. `DCO.md` is the Developer Certificate of Origin,
    // whose own terms allow verbatim copies only; the formatter would re-indent
    // its clauses.
    ignorePatterns: ["**/dist/**", "contracts/**", "DCO.md"],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "packages/client/src/core/generated/**",
      "packages/server/src/generated/**",
      "src/generated/**",
    ],
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
  test: {
    // `.claude/worktrees/` holds full checkouts of this repo made by agent
    // sessions. The root glob swept them in and collected a second copy of every
    // suite, against a different revision and without that checkout's installed
    // dependencies -- so they failed at import ("Vitest failed to find the
    // current suite", "Cannot read properties of undefined") and `vp test`
    // reported ~19 failed files that no source change could ever fix. They were
    // read as harness flakiness for weeks. A worktree is a checkout, not part of
    // this one.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/worktrees/**"],
  },
});
