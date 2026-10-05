import { defineConfig } from "vite-plus";

import { tsgoPath } from "../../scripts/tsgo-path.mjs";
import { buildKaitenCss } from "./scripts/build-kaiten-css.ts";
import { copyBrandAssets } from "./scripts/copy-brand-assets.ts";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: {
      index: "src/index.ts",
    },
    dts: {
      generator: "tsgo",
      tsgo: { path: tsgoPath },
    },
    exports: {
      customExports: {
        "./styles.css": "./dist/kaiten.css",
      },
    },
    // publint/attw cannot run inside `vp pack` here: the CSS subpath above is
    // emitted by the `build:done` hook below, which fires AFTER pack validation,
    // so both validators would inspect a dist without it and fail on "the file
    // does not exist". They run after the build instead, against the real
    // tarball: `node scripts/check-published-shape.mjs` (in CI and `pnpm ready`).
    deps: {
      neverBundle: ["react", "react-dom", "react/jsx-runtime"],
      // tsdown's default, spelled out so that `vp migrate` leaves it alone: the
      // migration writes `resolveDepSubpath: true` into any pack config that omits
      // it, which is how tsdown behaved before 0.23. Subpath imports such as
      // `react/jsx-runtime` stay as written, for the dependency's own `exports`
      // map to resolve.
      resolveDepSubpath: false,
    },
    hooks: {
      "build:done": async (context) => {
        await buildKaitenCss(context.options.outDir);
        await copyBrandAssets(context.options.outDir);
      },
    },
  },
  lint: {
    ignorePatterns: ["dist/**", "storybook-static/**", "playwright-report/**", "test-results/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**", "storybook-static/**", "playwright-report/**", "test-results/**"],
  },
});
