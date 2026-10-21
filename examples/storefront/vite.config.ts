// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, type Plugin } from "vite-plus";

import { storefront } from "./server/plugin.ts";
import { PALETTES } from "./src/themes/palettes.ts";
import { paletteStyleSheet } from "./src/themes/page-css.ts";

/**
 * The page's rules for each theme, generated from the theme objects (`src/themes`) and put in the
 * <head> of the page itself. Generated here and not when the app starts, so that they are in place
 * before the first paint: a visitor of Neo Brutalism does not see the Kaiten look for a moment.
 */
function palettes(): Plugin {
  return {
    name: "storefront-palettes",
    transformIndexHtml: () => [
      {
        tag: "style",
        attrs: { id: "storefront-palettes" },
        children: paletteStyleSheet(PALETTES),
        injectTo: "head",
      },
    ],
  };
}

// No React plugin: the build compiles JSX on its own, with the automatic runtime that
// tsconfig.json asks for ("jsx": "react-jsx"). `storefront()` is the backend: see server/plugin.ts.
//
// `vp test` is Vitest, which starts a Vite server of its own from this file. It does not get the
// backend: its tests build what they need, and a `.env` that names a Kaiten, or names half of one,
// must neither make a unit run go live nor stop it.
export default defineConfig(({ mode }) => ({
  plugins: [...(mode === "test" ? [] : [storefront()]), palettes()],
  test: {
    // The Playwright specs in e2e/ are the runner's own, and import `@playwright/test`.
    include: ["tests/**/*.test.ts"],
  },
}));
