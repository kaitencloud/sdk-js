import { defineConfig } from "vite-plus";

import { tsgoPath } from "../../scripts/tsgo-path.mjs";

export default defineConfig({
  pack: {
    dts: {
      // This package installs TypeScript 6 for openapi-ts, which drives the JS
      // compiler API. Its declarations still come from TypeScript 7's tsgo.
      generator: "tsgo",
      tsgo: { path: tsgoPath },
    },
    // Dual-built, unlike every other package here. This is the one meant to run
    // on a backend, and a large share of Node backends are still CommonJS — a
    // `require("@kaitencloud/server")` against an ESM-only build fails with
    // ERR_REQUIRE_ESM on Node < 22.12. The package has no dependencies of its
    // own, so shipping CJS costs nothing beyond the second output; the browser
    // packages stay ESM-only, where every bundler handles it.
    format: ["esm", "cjs"],
    // tsdown's default, spelled out so that `vp migrate` leaves it alone: the
    // migration writes `resolveDepSubpath: true` into any pack config that omits
    // it, which is how tsdown behaved before 0.23. This package has no runtime
    // dependency whose subpaths would need resolving.
    deps: { resolveDepSubpath: false },
    exports: true,
    // Verifies the published shape on every build: that the type entrypoints
    // resolve under node16/bundler rather than by dist adjacency, and that a CJS
    // consumer gets CJS. Both caught real defects the moment they were switched
    // on.
    publint: true,
    // `strict`, not tsdown 0.23's `esm-only` default: that profile skips the
    // CommonJS resolution this dual build exists for.
    attw: { profile: "strict" },
  },
  lint: {
    ignorePatterns: ["dist/**", "src/generated/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
