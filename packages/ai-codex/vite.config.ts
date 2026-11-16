// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite-plus";

import { tsgoPath } from "../../scripts/tsgo-path.mjs";

export default defineConfig({
  pack: {
    dts: { generator: "tsgo", tsgo: { path: tsgoPath } },
    // tsdown's default, spelled out so that `vp migrate` leaves it alone.
    deps: { resolveDepSubpath: false },
    exports: true,
    publint: true,
    // ESM-only, like @kaitencloud/client, which it builds on: the wrapper runs on
    // Node >= 22.12, where `require()` of an ES module works.
    attw: { profile: "strict", ignoreRules: ["cjs-resolves-to-esm"] },
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: { typeAware: true, typeCheck: true },
  },
  fmt: { ignorePatterns: ["dist/**"] },
});
