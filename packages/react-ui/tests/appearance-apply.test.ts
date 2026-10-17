// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { buildAppearanceStyle, resolveVariables } from "../src/appearance/apply.ts";
import { themes } from "../src/appearance/themes.ts";

// Read the installed `@kaitencloud/theme` via cwd-relative paths (import.meta.url is
// an http URL in the Vite test env, so node:fs can't resolve it). cwd is the package
// root under `vp test`, or the workspace root under `vp run -r test`.
//
// That stylesheet is where the SDK's defaults actually live: the `--ktn-*` build the
// components read is generated from the same values, so asserting against it checks
// the values that ship rather than a second copy.
function readThemeCss(): string {
  for (const prefix of ["", "packages/react-ui/"]) {
    try {
      return readFileSync(`${prefix}node_modules/@kaitencloud/theme/dist/global.css`, "utf8");
    } catch {
      // try the next candidate
    }
  }
  throw new Error("@kaitencloud/theme/dist/global.css not found from cwd");
}

/** One selector block of the theme, comments dropped and lines dedented. */
function readThemeBlock(selector: string): string {
  const css = readThemeCss().replace(/\/\*[\s\S]*?\*\//g, "");
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no "${selector} {" block in @kaitencloud/theme`);
  return css
    .slice(start, css.indexOf("}", start))
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");
}

const lightTokens = readThemeBlock(":root");
const darkTokens = readThemeBlock(".dark");

// `themes.default` must be a genuine no-op — its values must match the SDK's
// built-in light defaults. Before, its primaryColor (#8c5cff) diverged from the CSS
// (#7c47e8, the AA-darkened brand), so applying the "default" theme visibly shifted
// the color (and broke WCAG-AA contrast).
describe("themes.default is a faithful no-op", () => {
  function tokenIn(partial: string, name: string): string | undefined {
    return new RegExp(`^--${name}:\\s*([^;]+);`, "m").exec(partial)?.[1]?.trim().toLowerCase();
  }

  const lightVar = (name: string) => tokenIn(lightTokens, name);

  test("it overrides nothing, so it cannot drift from the tokens", () => {
    // Theme presets are KaitenAppearance objects — values live on `variables`.
    // Restating the defaults here is what let this preset drift from them before;
    // a no-op is now structural rather than something a test has to police.
    expect(themes.default.variables).toEqual({});
    expect(resolveVariables(themes.default.variables)).toEqual({});
  });

  test("a text-bearing fill is one value in both modes, and it carries white", () => {
    // The rule, pinned. White ink on a strong fill is an identity decision, and it
    // constrains the palette rather than the reverse: a fill that carries white has
    // to be dark enough for it, in EITHER mode, so there is no reason for the two to
    // differ. `--primary` and `--destructive` are therefore mode-invariant.
    //
    // #8f52ea is the nearest colour to the brand VIOLET #9f5ffa (ΔE2000 5.18) that
    // still carries white at 4.60:1 — half the deviation of the #7c47e8 it replaced.
    // The authored #9f5ffa survives on `ring` and `chart-2`, which carry nothing.
    //
    // Surfaces are a different story and stay mode-specific: dark still uses the
    // brand NOIR and GRADIENT NOIR untouched.
    expect(lightVar("primary")).toBe("#8f52ea");
    expect(tokenIn(darkTokens, "primary")).toBe("#8f52ea");
    expect(lightVar("primary-foreground")).toBe("#ffffff");
    expect(tokenIn(darkTokens, "primary-foreground")).toBe("#ffffff");

    // The authored violet survives where nothing sits on top of it.
    expect(tokenIn(darkTokens, "ring")).toBe("#9f5ffa");
    expect(tokenIn(darkTokens, "chart-2")).toBe("#9f5ffa");
  });

  test("each status colour is one value in both modes, carrying white", () => {
    // The mint #09cf8d cannot be the semantic green: `success` has to carry white
    // (the solid badge), and separate from BOTH the white card and the dark one. An
    // exhaustive search says every colour meeting those three lands at ΔE2000 ≥ 21
    // from the mint — #068854 sits at 21.09, the nearest that exists.
    //
    // So the mint is a BRAND colour, not a status colour, and it is absent from the
    // semantic palette on purpose. Two greens on one card read as a mistake, which is
    // the failure this assertion exists to prevent.
    expect(lightVar("success")).toBe("#068854");
    expect(tokenIn(darkTokens, "success")).toBe("#068854");
    expect(lightVar("success-foreground")).toBe("#ffffff");
    expect(tokenIn(darkTokens, "success-foreground")).toBe("#ffffff");
    expect(tokenIn(darkTokens, "chart-1")).toBe("#068854");

    // Warning follows the same rule, for the same reason.
    expect(lightVar("warning")).toBe("#cf4a03");
    expect(tokenIn(darkTokens, "warning")).toBe("#cf4a03");
    expect(lightVar("warning-foreground")).toBe("#ffffff");
    expect(tokenIn(darkTokens, "warning-foreground")).toBe("#ffffff");
  });

  test("newly exposed override tokens (popover/input/success) reach their CSS vars", () => {
    const style = resolveVariables({
      colorPopover: "#111",
      colorInput: "#222",
      colorSuccess: "#333",
    });
    expect(style["--ktn-popover"]).toBe("#111");
    expect(style["--ktn-input"]).toBe("#222");
    // `colorSuccessBadge` is gone: the badge paints `--ktn-success` itself now, so a
    // separate badge token would be a second green to keep in step with the brand.
    expect(style["--ktn-success"]).toBe("#333");
  });
});

describe("resolveVariables", () => {
  test("resolves nothing from nothing", () => {
    expect(resolveVariables()).toEqual({});
    expect(resolveVariables(undefined)).toEqual({});
    expect(resolveVariables({})).toEqual({});
  });

  test("ignores undefined values", () => {
    expect(resolveVariables({ colorPrimary: undefined })).toEqual({});
  });

  test("maps a single variable to its public ktn CSS token", () => {
    const style = resolveVariables({ colorPrimary: "#ff00ff" });

    expect(style).toMatchObject({
      "--ktn-primary": "#ff00ff",
      // A fill arriving alone brings its companions — a readable text colour
      // and a hover shifted away from it. See appearance-contrast for the ratios.
      "--ktn-primary-foreground": "#000000",
    });
    expect(style["--ktn-primary-hover"]).toBeDefined();
    expect(style["--primary"]).toBeUndefined();
    expect(style["--kaiten-color-primary"]).toBeUndefined();
    expect(Object.keys(style).sort()).toEqual([
      "--ktn-primary",
      "--ktn-primary-foreground",
      "--ktn-primary-hover",
    ]);
  });

  test("expands every supported variable, skipping the ones not provided", () => {
    const style = resolveVariables({
      colorPrimary: "#111",
      colorBackground: "#222",
      colorForeground: "#333",
      colorCard: "#444",
      colorCardForeground: "#555",
      colorDestructive: "#666",
      colorDestructiveForeground: "#777",
      colorSuccess: "#888",
      colorSuccessForeground: "#999",
      colorMuted: "#aaa",
      colorMutedForeground: "#bbb",
      colorSecondary: "#ccc",
      colorSecondaryForeground: "#ddd",
      colorAccent: "#eee",
      colorAccentForeground: "#fff",
      colorBorder: "#012",
      colorRing: "#345",
      borderRadius: "12px",
      fontFamily: "Inter, sans-serif",
    });

    expect(style["--ktn-primary"]).toBe("#111");
    expect(style["--ktn-background"]).toBe("#222");
    expect(style["--ktn-card-foreground"]).toBe("#555");
    expect(style["--ktn-destructive-foreground"]).toBe("#777");
    expect(style["--ktn-success-foreground"]).toBe("#999");
    expect(style["--ktn-muted-foreground"]).toBe("#bbb");
    expect(style["--ktn-secondary-foreground"]).toBe("#ddd");
    expect(style["--ktn-accent-foreground"]).toBe("#fff");
    expect(style["--ktn-border"]).toBe("#012");
    expect(style["--ktn-ring"]).toBe("#345");
    expect(style["--ktn-radius"]).toBe("12px");
    expect(style["--ktn-font-sans"]).toBe("Inter, sans-serif");
    expect(style["--primary"]).toBeUndefined();
    expect(style["--kaiten-color-primary"]).toBeUndefined();

    // Every pair above was supplied explicitly except primary's, so its
    // foreground is derived — `#111` is dark, so white reads on it — plus a hover
    // for each of the five fills that has one and was not given it.
    expect(style["--ktn-primary-foreground"]).toBe("#ffffff");
    for (const hover of [
      "--ktn-primary-hover",
      "--ktn-secondary-hover",
      "--ktn-destructive-hover",
      "--ktn-accent-hover",
      "--ktn-success-hover",
    ]) {
      expect(style[hover]).toBeDefined();
    }
    // The background now rebuilds the surfaces that were NOT supplied: popover
    // and input, plus the derived popover's own text. Everything supplied
    // explicitly above stayed untouched.
    expect(style["--ktn-popover"]).toBeDefined();
    expect(style["--ktn-input"]).toBeDefined();
    expect(style["--ktn-popover-foreground"]).toBeDefined();
    expect(Object.keys(style)).toHaveLength(28);
  });

  test("adds the portal z-index variable when configured", () => {
    const style = buildAppearanceStyle({ zIndex: 240 }) as Record<string, string>;

    expect(style).toEqual({ "--ktn-z-portal": "240" });
  });
});

// The bug this section pins down: `themes.midnight` applied WITHOUT its
// baseTheme (palette and light/dark are independent axes for some hosts)
// used to render a dark page carrying the light theme's white cards and
// black card text, because nothing rebuilt the surfaces around an overridden
// background. A background now brings its neutral family, the way a fill
// already brought its foreground and hover.
describe("surfaces derived from colorBackground", () => {
  function luminanceOf(hex: string): number {
    const channels = [1, 3, 5].map((i) => {
      const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  test("a dark background rebuilds every neutral surface, none stays light", () => {
    // themes.midnight's background, alone — the exact half-application case.
    const style = resolveVariables({ colorBackground: "#0f172a" });
    const background = luminanceOf("#0f172a");

    // Elevated surfaces are lighter than the page but nowhere near white.
    for (const surface of ["--ktn-card", "--ktn-popover"]) {
      const value = style[surface]!;
      expect(luminanceOf(value)).toBeGreaterThan(background);
      expect(luminanceOf(value)).toBeLessThan(0.2);
    }
    // Textward neutrals step toward the (derived, white) text.
    for (const surface of ["--ktn-muted", "--ktn-secondary", "--ktn-border", "--ktn-input"]) {
      expect(luminanceOf(style[surface]!)).toBeGreaterThan(background);
    }
    // Borders step further than fills, as the shipped tokens do.
    expect(luminanceOf(style["--ktn-border"]!)).toBeGreaterThan(luminanceOf(style["--ktn-muted"]!));
    // And the derived surfaces got readable text of their own.
    expect(style["--ktn-foreground"]).toBe("#ffffff");
    expect(style["--ktn-card-foreground"]).toBe("#ffffff");
    expect(style["--ktn-popover-foreground"]).toBe("#ffffff");
    expect(style["--ktn-secondary-foreground"]).toBe("#ffffff");
    // Muted text relaxed from the foreground — secondary, not black-or-white.
    expect(style["--ktn-muted-foreground"]).not.toBe("#ffffff");
    expect(luminanceOf(style["--ktn-muted-foreground"]!)).toBeGreaterThan(0.2);
  });

  test("a tinted light background keeps cards at or above it, text dark", () => {
    // themes.rose's background.
    const style = resolveVariables({ colorBackground: "#fff8fb" });
    const background = luminanceOf("#fff8fb");

    expect(luminanceOf(style["--ktn-card"]!)).toBeGreaterThanOrEqual(background);
    expect(style["--ktn-foreground"]).toBe("#000000");
    // Textward neutrals go darker here — toward the black text.
    expect(luminanceOf(style["--ktn-muted"]!)).toBeLessThan(background);
    expect(luminanceOf(style["--ktn-border"]!)).toBeLessThan(luminanceOf(style["--ktn-muted"]!));
  });

  test("an explicit foreground steers the derivation instead of black-or-white", () => {
    // themes.midnight ships both; the derived muted text must carry the
    // explicit foreground's character, not a generic grey from #ffffff.
    const style = resolveVariables({
      colorBackground: "#0f172a",
      colorForeground: "#f8fafc",
    });

    expect(style["--ktn-foreground"]).toBe("#f8fafc");
    expect(luminanceOf(style["--ktn-card"]!)).toBeGreaterThan(luminanceOf("#0f172a"));
    expect(luminanceOf(style["--ktn-muted-foreground"]!)).toBeLessThan(luminanceOf("#f8fafc"));
  });

  test("every explicitly set surface wins over the derivation", () => {
    const style = resolveVariables({
      colorBackground: "#0f172a",
      colorCard: "#123456",
      colorMutedForeground: "#778899",
    });

    expect(style["--ktn-card"]).toBe("#123456");
    expect(style["--ktn-muted-foreground"]).toBe("#778899");
    // The explicit card still gets a readable text derived FOR IT.
    expect(style["--ktn-card-foreground"]).toBe("#ffffff");
  });

  test("an unparseable background derives nothing rather than guessing", () => {
    const style = resolveVariables({
      colorBackground: "oklch(20% 0.05 260)",
    });

    expect(style["--ktn-background"]).toBe("oklch(20% 0.05 260)");
    expect(style["--ktn-card"]).toBeUndefined();
    expect(style["--ktn-muted"]).toBeUndefined();
    expect(style["--ktn-border"]).toBeUndefined();
  });

  test("a host's full dark palette yields a coherent dark set", () => {
    // The exact values themes.midnight used to ship — kept inline because the
    // preset no longer carries surfaces, and the regression is about any host
    // bringing its own dark background and foreground.
    const style = resolveVariables({
      colorPrimary: "#7c3aed",
      colorBackground: "#0f172a",
      colorForeground: "#f8fafc",
    });

    // No surface may sit in the light half while the page is dark: this is
    // the white-cards-on-dark-page rendering, pinned as a regression test.
    for (const surface of ["--ktn-card", "--ktn-popover", "--ktn-muted", "--ktn-secondary"]) {
      expect(luminanceOf(style[surface]!)).toBeLessThan(0.5);
    }
    expect(style["--ktn-card-foreground"]).toBe("#ffffff");
  });

  test("no preset carries a colour mode, and none puts a surface in `variables`", () => {
    // A preset that ships a baseTheme couples two independent axes — a host
    // with its own light/dark toggle picks midnight and gets a dark island.
    // Surfaces are allowed, but only under `modes`: in `variables` they would
    // apply in the mode they were never designed for, which is how a dark
    // background ended up under the light theme's white cards.
    for (const [name, theme] of Object.entries(themes)) {
      expect({ name, baseTheme: (theme as { baseTheme?: string }).baseTheme }).toEqual({
        name,
        baseTheme: undefined,
      });
      const keys = Object.keys(theme.variables);
      expect({
        name,
        surfaces: keys.filter((k) =>
          /Background|Foreground|Card|Popover|Muted|Border|Input/.test(k),
        ),
      }).toEqual({ name, surfaces: [] });
    }
  });

  test("a preset's surfaces reach only the mode they were designed for", () => {
    const style = buildAppearanceStyle(themes.midnight) as Record<string, string>;

    // Slate surfaces in dark, nothing imposed in light: midnight in a light page
    // is the brand colour on the default light surfaces, not a dark island. The
    // brand itself holds in both, and the dark palette derived its own family.
    expect(style["--ktn-dark-background"]).toBe("#0f172a");
    expect(style["--ktn-light-background"]).toBeUndefined();
    expect(style["--ktn-dark-card"]).toBeDefined();
    expect(style["--ktn-light-primary"]).toBe("#7c3aed");
    expect(style["--ktn-dark-primary"]).toBe("#7c3aed");
  });

  test("legacy: overriding only fills still derives no surface", () => {
    const style = resolveVariables({ colorPrimary: "#ff00ff" });

    expect(Object.keys(style).sort()).toEqual([
      "--ktn-primary",
      "--ktn-primary-foreground",
      "--ktn-primary-hover",
    ]);
  });

  test("legacy z-index shape is untouched", () => {
    const style = buildAppearanceStyle({ zIndex: 240 }) as Record<string, string>;

    expect(style).toEqual({ "--ktn-z-portal": "240" });
  });

  test("ignores unknown keys not registered in the variable map", () => {
    const style = resolveVariables({
      colorPrimary: "#abc",
      // @ts-expect-error -- intentional unknown key to exercise the lookup miss
      colorMystery: "#999",
    });

    expect(style["--ktn-primary"]).toBe("#abc");
    // Only the known key and what it derives — the unknown one is dropped rather
    // than passed through as a stray custom property.
    expect(Object.keys(style).sort()).toEqual([
      "--ktn-primary",
      "--ktn-primary-foreground",
      "--ktn-primary-hover",
    ]);
  });
});
