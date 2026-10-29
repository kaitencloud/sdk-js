// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { API } from "storybook/manager-api";
import { addons } from "storybook/manager-api";
import { create } from "storybook/theming/create";

const THEME_GLOBAL = "theme";
const GLOBALS_UPDATED = "globalsUpdated";
const BRAND_TITLE = "Kaiten React";
const BRAND_URL = "https://github.com/kaitencloud/sdk-js";
const FONT_SANS = "DM Sans, ui-sans-serif, sans-serif, system-ui";
const FONT_MONO = "Source Code Pro, ui-monospace, monospace";
const MANAGER_STYLES_ID = "kaiten-storybook-manager-styles";

/**
 * The manager chrome, mirrored from `@kaitencloud/theme`.
 *
 * These are literals and have to be: the manager is a separate React root outside
 * the preview iframe, so it never sees the `.kaiten` custom properties, and
 * `create()` takes plain strings. That makes this file the one place in the SDK
 * where the palette is copied rather than referenced — and it drifted exactly as
 * you would expect, sitting on the 0.3.3 values (`#7c47e8`, `#8c5cff`, `#1a1b1e`,
 * `#222327`, `#2a2c33`) for the whole life of 0.4.0.
 *
 * Realigned 3 September 2026. Each value below is a token, named in the comment
 * beside it where the mapping is not obvious. If a token changes in the theme's
 * source (`packages/theme/src/styles` in kaitencloud/kaiten), change it here too —
 * nothing will tell you.
 */
const managerThemes = {
  light: create({
    base: "light",
    brandTitle: BRAND_TITLE,
    brandUrl: BRAND_URL,
    brandTarget: "_blank",
    brandImage: "/storybook-assets/kaiten-logo-light.svg",
    colorPrimary: "#8f52ea",
    colorSecondary: "#9f5ffa",
    appBg: "#f7f7f7",
    appContentBg: "#ffffff",
    appHoverBg: "#f7f7f7",
    appPreviewBg: "#ffffff",
    appBorderColor: "#e2e2e2",
    appBorderRadius: 10,
    fontBase: FONT_SANS,
    fontCode: FONT_MONO,
    textColor: "#070708",
    textInverseColor: "#ffffff",
    textMutedColor: "#525252",
    barTextColor: "#525252",
    barHoverColor: "#070708",
    barSelectedColor: "#8f52ea",
    barBg: "#ffffff",
    buttonBg: "#ffffff",
    buttonBorder: "#e2e2e2",
    booleanBg: "#e2e2e2",
    booleanSelectedBg: "#8f52ea",
    inputBg: "#ffffff",
    inputBorder: "#e2e2e2",
    inputTextColor: "#070708",
    inputBorderRadius: 10,
  }),
  dark: create({
    base: "dark",
    brandTitle: BRAND_TITLE,
    brandUrl: BRAND_URL,
    brandTarget: "_blank",
    brandImage: "/storybook-assets/kaiten-logo-dark.svg",
    colorPrimary: "#8f52ea",
    colorSecondary: "#9f5ffa",
    appBg: "#070708",
    appContentBg: "#111019",
    appHoverBg: "#242239",
    appPreviewBg: "#111019",
    appBorderColor: "#24232b",
    appBorderRadius: 10,
    fontBase: FONT_SANS,
    fontCode: FONT_MONO,
    textColor: "#f3f4f6",
    textInverseColor: "#070708",
    textMutedColor: "#a0a0a0",
    barTextColor: "#a0a0a0",
    barHoverColor: "#f3f4f6",
    barSelectedColor: "#9f5ffa",
    barBg: "#111019",
    buttonBg: "#242239",
    buttonBorder: "#24232b",
    booleanBg: "#24232b",
    booleanSelectedBg: "#8f52ea",
    inputBg: "#242239",
    inputBorder: "#24232b",
    inputTextColor: "#f3f4f6",
    inputBorderRadius: 10,
  }),
};

type ManagerTheme = keyof typeof managerThemes;

let appliedTheme: ManagerTheme | undefined;

function installManagerStyles(): void {
  if (typeof document === "undefined" || document.getElementById(MANAGER_STYLES_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = MANAGER_STYLES_ID;
  style.textContent = `
    .sidebar-container .sidebar-header {
      padding-left: 0 !important;
    }
  `;
  document.head.append(style);
}

function resolveManagerTheme(theme: unknown): ManagerTheme {
  return theme === "dark" ? "dark" : "light";
}

function applyManagerTheme(theme: unknown): void {
  const nextTheme = resolveManagerTheme(theme);

  if (appliedTheme === nextTheme) {
    return;
  }

  appliedTheme = nextTheme;
  addons.setConfig({ theme: managerThemes[nextTheme] });
}

installManagerStyles();
applyManagerTheme("light");

addons.register("kaiten/manager-theme-sync", (api: API) => {
  applyManagerTheme(api.getUserGlobals()?.[THEME_GLOBAL]);

  api.on(GLOBALS_UPDATED, ({ userGlobals }: { userGlobals?: Record<string, unknown> }) => {
    applyManagerTheme(userGlobals?.[THEME_GLOBAL]);
  });
});
