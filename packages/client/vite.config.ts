import { defineConfig } from "vite-plus";

import { tsgoPath } from "../../scripts/tsgo-path.mjs";

export default defineConfig({
  pack: {
    // The `exports` map in package.json is GENERATED from these entries by
    // `vp pack` — editing it by hand is overwritten on the next build. A new
    // public subpath is added here.
    entry: {
      index: "src/index.ts",
      testing: "src/testing/index.ts",
    },
    dts: {
      // This package installs TypeScript 6 for openapi-ts, which drives the JS
      // compiler API. Its declarations still come from TypeScript 7's tsgo.
      generator: "tsgo",
      tsgo: { path: tsgoPath },
    },
    // tsdown's default, spelled out so that `vp migrate` leaves it alone: the
    // migration writes `resolveDepSubpath: true` into any pack config that omits
    // it, which is how tsdown behaved before 0.23. This package has no runtime
    // dependency whose subpaths would need resolving.
    deps: { resolveDepSubpath: false },
    exports: true,
    publint: true,
    // ESM-only by design (browser + bundler consumers). `cjs-resolves-to-esm`
    // and the node10 `no-resolution` on subpaths are the declared shape, not
    // defects: supporting either would mean dual-building the whole chain.
    // Only @kaitencloud/server, which runs on a backend, is dual-built.
    // `strict` checks every resolution mode, as attw did before tsdown 0.23 made
    // `esm-only` the default; that profile skips node10 and CommonJS altogether
    // rather than ignoring just these two rules.
    attw: { profile: "strict", ignoreRules: ["cjs-resolves-to-esm", "no-resolution"] },
  },
  lint: {
    ignorePatterns: ["dist/**", "src/core/generated/**", "src/graphql/generated/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
