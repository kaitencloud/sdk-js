// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { buildAppearanceStyle } from "../src/appearance/apply.ts";
import { mergeAppearance } from "../src/appearance/context.tsx";

// The whole mechanism in one sentence: the generated stylesheet reads every
// token THROUGH a per-mode namespace, and the provider writes both namespaces
// inline. The cascade then picks the one that belongs to the active mode —
// something an inline style could never do on its own, which is why a per-mode
// palette was impossible before and why `baseTheme: "light"` was unenforceable
// inside a dark host page.
function readBuiltCss(): string {
  for (const candidate of ["dist/kaiten.css", "packages/react-ui/dist/kaiten.css"]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // try the next candidate
    }
  }
  throw new Error("dist/kaiten.css not found — run `vp pack` first");
}

describe("the stylesheet reads tokens through a per-mode namespace", () => {
  const css = readBuiltCss();

  test("the light rule reads --ktn-light-*, the dark rule --ktn-dark-*", () => {
    expect(css).toContain("--ktn-background: var(--ktn-light-background, #ffffff)");
    expect(css).toContain("--ktn-background: var(--ktn-dark-background, #1a1b1e)");
  });

  test("no token is left un-namespaced, or one mode of it would be unreachable", () => {
    // A declaration inside the two token blocks that is not indirected would be
    // silently un-overridable for that mode — the exact failure this design
    // exists to make impossible. Checked over the blocks, not the whole sheet.
    const block = (selector: string) => {
      const start = css.indexOf(selector);
      return css.slice(start, css.indexOf("}", start));
    };

    for (const [selector, mode] of [
      [".kaiten {\n  --ktn-background", "light"],
      [".kaiten.dark, .dark .kaiten:not(.ktn-light) {", "dark"],
    ] as const) {
      const declarations = [...block(selector).matchAll(/^\s*(--ktn-[a-z0-9-]+):\s*(.+);$/gim)];
      expect(declarations.length).toBeGreaterThan(50);
      const unNamespaced = declarations
        .filter(([, , value]) => !value!.startsWith(`var(--ktn-${mode}-`))
        .map(([, name]) => name);
      expect({ mode, unNamespaced }).toEqual({ mode, unNamespaced: [] });
    }
  });

  test("the dark rule exempts an explicitly light subtree", () => {
    // `.dark .kaiten` is the inherit-from-the-host branch; `:not(.ktn-light)` is
    // what lets an integrator override it. Without it, `baseTheme: "light"`
    // rendered dark inside any shadcn host — verified in kaiten/app.
    expect(css).toContain(".dark .kaiten:not(.ktn-light)");
  });
});

describe("buildAppearanceStyle", () => {
  test("a mode-independent variable is written into both namespaces", () => {
    const style = buildAppearanceStyle({ variables: { colorPrimary: "#7c3aed" } }) as Record<
      string,
      string
    >;

    expect(style["--ktn-light-primary"]).toBe("#7c3aed");
    expect(style["--ktn-dark-primary"]).toBe("#7c3aed");
    // And its companions were derived once per mode.
    expect(style["--ktn-light-primary-foreground"]).toBe("#ffffff");
    expect(style["--ktn-dark-primary-foreground"]).toBe("#ffffff");
  });

  test("a per-mode variable lands in one namespace only", () => {
    const style = buildAppearanceStyle({
      modes: { dark: { colorBackground: "#0f172a" } },
    }) as Record<string, string>;

    expect(style["--ktn-dark-background"]).toBe("#0f172a");
    expect(style["--ktn-light-background"]).toBeUndefined();
    // The dark palette derived its own surfaces; the light one has none to derive.
    expect(style["--ktn-dark-card"]).toBeDefined();
    expect(style["--ktn-light-card"]).toBeUndefined();
  });

  test("each mode derives independently, so the two sets differ", () => {
    const style = buildAppearanceStyle({
      modes: {
        light: { colorBackground: "#f8fafc" },
        dark: { colorBackground: "#0f172a" },
      },
    }) as Record<string, string>;

    expect(style["--ktn-light-foreground"]).toBe("#000000");
    expect(style["--ktn-dark-foreground"]).toBe("#ffffff");
    expect(style["--ktn-light-card"]).not.toBe(style["--ktn-dark-card"]);
  });

  test("a per-mode value wins over the mode-independent one, for that mode only", () => {
    const style = buildAppearanceStyle({
      variables: { colorPrimary: "#7c3aed" },
      modes: { dark: { colorPrimary: "#a78bfa" } },
    }) as Record<string, string>;

    expect(style["--ktn-light-primary"]).toBe("#7c3aed");
    expect(style["--ktn-dark-primary"]).toBe("#a78bfa");
  });

  test("zIndex stays mode-independent and un-namespaced", () => {
    const style = buildAppearanceStyle({ zIndex: 240 }) as Record<string, string>;

    expect(style).toEqual({ "--ktn-z-portal": "240" });
  });

  test("an empty appearance produces nothing", () => {
    expect(buildAppearanceStyle()).toBeUndefined();
    expect(buildAppearanceStyle({ variables: {}, modes: {} })).toBeUndefined();
  });
});

test("a nested style root keeps the per-mode palettes of the root above it", () => {
  // `modes` was the one field mergeAppearance dropped. Nothing failed while the
  // provider applied its own appearance directly; once KaitenStyleRoot became
  // the only path, an appearance whose surfaces live in `modes` — the shape the
  // docs recommend — resolved to the defaults instead.
  const merged = mergeAppearance(
    { variables: { colorPrimary: "#7c3aed" }, modes: { dark: { colorBackground: "#0f172a" } } },
    { modes: { light: { colorBackground: "#f8fafc" } } },
  );

  const style = buildAppearanceStyle(merged) as Record<string, string>;
  expect(style["--ktn-light-background"]).toBe("#f8fafc");
  expect(style["--ktn-dark-background"]).toBe("#0f172a");
  expect(style["--ktn-light-primary"]).toBe("#7c3aed");
});
