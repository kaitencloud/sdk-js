import { defineConfig } from "vite-plus";

import { tsgoPath } from "../../scripts/tsgo-path.mjs";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    entry: {
      index: "src/index.ts",
      // What `@kaitencloud/react-ui` needs from the core and a host does not.
      internal: "src/internal.ts",
      // The hooks of a checkout and a customer portal, which a host that offers neither
      // does not bundle.
      billing: "src/billing.ts",
      // One export per language, so a host bundles the packs it ships.
      locales: "src/locales.ts",
      types: "src/types.ts",
    },
    dts: {
      generator: "tsgo",
      tsgo: { path: tsgoPath },
    },
    deps: {
      neverBundle: ["react", "react-dom", "react/jsx-runtime"],
      // tsdown's default, spelled out so that `vp migrate` leaves it alone: the
      // migration writes `resolveDepSubpath: true` into any pack config that omits
      // it, which is how tsdown behaved before 0.23. Subpath imports such as
      // `react/jsx-runtime` stay as written, for the dependency's own `exports`
      // map to resolve.
      resolveDepSubpath: false,
    },
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["dist/**"],
  },
});
