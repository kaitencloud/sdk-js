// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The themes of the storefront: the mapper from a shadcn theme to the components' appearance, the
// page's CSS for a theme, and the contrast of the two themes taken from tweakcn.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { claude, claudeExport, claudeOverrides } from "../src/themes/claude.ts";
import {
  contrastRatio,
  hoverFor,
  hoverShade,
  legible,
  mix,
  parseHex,
} from "../src/themes/color.ts";
import {
  neoBrutalism,
  neoBrutalismExport,
  neoBrutalismOverrides,
} from "../src/themes/neo-brutalism.ts";
import { pageTokens, paletteStyleSheet } from "../src/themes/page-css.ts";
import { PALETTE_STORAGE_KEY, PALETTES } from "../src/themes/palettes.ts";
import {
  applyOverrides,
  type Override,
  type ShadcnToken,
  type ShadcnTheme,
} from "../src/themes/shadcn.ts";
import { THEMED_ELEMENTS, toAppearance } from "../src/themes/to-appearance.ts";

const THEMES: ReadonlyArray<{
  name: string;
  exported: ShadcnTheme;
  adjusted: ShadcnTheme;
  overrides: readonly Override[];
}> = [
  { name: "Claude", exported: claudeExport, adjusted: claude, overrides: claudeOverrides },
  {
    name: "Neo Brutalism",
    exported: neoBrutalismExport,
    adjusted: neoBrutalism,
    overrides: neoBrutalismOverrides,
  },
];

const MODES = ["light", "dark"] as const;

/** The text pairs of a theme: the surface or fill, and what is written on it. */
const PAIRS: ReadonlyArray<readonly [ShadcnToken, ShadcnToken]> = [
  ["primary", "primary-foreground"],
  ["destructive", "destructive-foreground"],
  ["secondary", "secondary-foreground"],
  ["accent", "accent-foreground"],
  ["popover", "popover-foreground"],
  ["card", "card-foreground"],
  ["background", "foreground"],
  ["muted", "muted-foreground"],
  ["background", "muted-foreground"],
  ["card", "muted-foreground"],
];

/** The pairs that read under `minimum`:1, as `mode: surface/text`. */
function failing(theme: ShadcnTheme, minimum = 4.5): string[] {
  return MODES.flatMap((mode) =>
    PAIRS.filter(
      ([surface, text]) => contrastRatio(theme[mode][surface]!, theme[mode][text]!) < minimum,
    ).map(([surface, text]) => `${mode}: ${surface}/${text}`),
  );
}

describe("color", () => {
  it("reads short and long hex, and nothing else", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#c96442")).toEqual([201, 100, 66]);
    expect(parseHex("oklch(0.6 0.15 40)")).toBeUndefined();
    expect(parseHex("var(--x)")).toBeUndefined();
  });

  it("measures WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#c96442", "#ffffff")).toBeCloseTo(3.9, 1);
    expect(contrastRatio("#ffffff", "#c96442")).toBe(contrastRatio("#c96442", "#ffffff"));
  });

  it("mixes channel by channel", () => {
    expect(mix("#ffffff", "#000000", 0.5)).toBe("#808080");
    expect(mix("#102030", "#000000", 1)).toBe("#000000");
    expect(mix("#102030", "#000000", 0)).toBe("#102030");
  });

  it("leaves a colour that already reads, and darkens one that does not by the least step", () => {
    expect(legible("#6a6965", ["#ffffff"])).toBe("#6a6965");
    const darker = legible("#c96442", ["#ffffff"]);
    expect(contrastRatio(darker, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    // The same search, written out: the first step of 0.5% toward black that reads, and the one
    // before it, which does not.
    const steps = Array.from({ length: 201 }, (_, k) => mix("#c96442", "#000000", k * 0.005));
    const first = steps.findIndex((candidate) => contrastRatio(candidate, "#ffffff") >= 4.5);
    expect(darker).toBe(steps[first]);
    expect(contrastRatio(steps[first - 1]!, "#ffffff")).toBeLessThan(4.5);
  });

  it("lightens toward white when asked", () => {
    const lighter = legible("#b06046", ["#262624"], { pole: "#ffffff" });
    expect(contrastRatio(lighter, "#262624")).toBeGreaterThanOrEqual(4.5);
  });

  it("moves a hover away from its label, and the other way when it cannot", () => {
    const under = (fill: string, label: string) => hoverShade(fill, label)!;
    expect(under("#b95c3d", "#ffffff")).toBe(mix("#b95c3d", "#000000", 0.1)); // darker under white
    expect(under("#ff6666", "#000000")).toBe(mix("#ff6666", "#ffffff", 0.1)); // lighter under black
    expect(under("#faf9f5", "#30302e")).toBe(mix("#faf9f5", "#000000", 0.1)); // near white: darker
    expect(hoverShade("oklch(0.6 0.15 40)", "#ffffff")).toBeUndefined();
  });

  it("derives a hover for a colour that is not hex with color-mix", () => {
    expect(hoverFor("oklch(0.6 0.15 40)", "#ffffff")).toBe(
      "color-mix(in srgb, oklch(0.6 0.15 40) 90%, black)",
    );
  });
});

describe("the two themes as exported", () => {
  it("hold every token of the paste, with nothing added", () => {
    for (const { exported } of THEMES) {
      // tweakcn writes 52 properties in `:root` and 50 in `.dark` (no tracking, no spacing).
      expect(Object.keys(exported.light)).toHaveLength(52);
      expect(Object.keys(exported.dark)).toHaveLength(50);
    }
  });

  it("fail WCAG AA for text on exactly the pairs the overrides fix", () => {
    expect(failing(claudeExport)).toEqual([
      "light: primary/primary-foreground",
      "light: muted/muted-foreground",
      "light: background/muted-foreground",
      "light: card/muted-foreground",
      "dark: primary/primary-foreground",
      "dark: destructive/destructive-foreground",
    ]);
    expect(failing(neoBrutalismExport)).toEqual(["light: primary/primary-foreground"]);
  });
});

describe("overrides", () => {
  it("replace a value of a copy, and leave the export as it was", () => {
    const before = JSON.stringify(claudeExport);
    const adjusted = applyOverrides(claudeExport, claudeOverrides);
    expect(JSON.stringify(claudeExport)).toBe(before);
    expect(adjusted.light.primary).toBe("#b95c3d");
    expect(adjusted.light.background).toBe(claudeExport.light.background);
  });

  it("refuse a value that is not the one exported", () => {
    const stale: Override = {
      mode: "light",
      token: "primary",
      from: "#000000",
      to: "#111111",
      reason: "stale",
    };
    expect(() => applyOverrides(claudeExport, [stale])).toThrow(/expects #000000/);
  });

  for (const { name, exported, overrides } of THEMES) {
    for (const override of overrides) {
      it(`${name}, ${override.mode} ${override.token}: ${override.from} to ${override.to}, the least darkening that reads`, () => {
        const { mode, token, from, to } = override;
        expect(exported[mode][token]).toBe(from);
        // The surfaces the value is read on: a fill under its label, text on its backgrounds.
        const against =
          token === "muted-foreground"
            ? [exported[mode].background!, exported[mode].card!, exported[mode].muted!]
            : [exported[mode][`${token}-foreground` as ShadcnToken]!];
        expect(Math.min(...against.map((surface) => contrastRatio(from, surface)))).toBeLessThan(
          4.5,
        );
        expect(
          Math.min(...against.map((surface) => contrastRatio(to, surface))),
        ).toBeGreaterThanOrEqual(4.5);
        expect(legible(from, against)).toBe(to);
      });
    }
  }
});

describe("the two themes as the storefront uses them", () => {
  for (const { name, adjusted } of THEMES) {
    it(`${name}: every text pair reads at 4.5:1 in Light and in Dark`, () => {
      expect(failing(adjusted)).toEqual([]);
    });

    it(`${name}: the hover of each fill still reads under its label`, () => {
      for (const mode of MODES) {
        for (const [fill, label] of PAIRS.slice(0, 4)) {
          const hover = hoverFor(adjusted[mode][fill]!, adjusted[mode][label]!);
          expect(
            contrastRatio(hover, adjusted[mode][label]!),
            `${mode} ${fill}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});

describe("toAppearance", () => {
  const appearance = toAppearance(claude);

  it("puts the colours of each block in its own mode, and none in `variables`", () => {
    expect(appearance.modes.light).toMatchObject({
      colorBackground: "#faf9f5",
      colorForeground: "#3d3929",
      colorPrimary: "#b95c3d",
      colorPrimaryForeground: "#ffffff",
      colorMutedForeground: "#6a6965",
      colorBorder: "#dad9d4",
      colorInput: "#b4b2a7",
      colorRing: "#c96442",
    });
    expect(appearance.modes.dark).toMatchObject({
      colorBackground: "#262624",
      colorPrimary: "#b06046",
      colorDestructive: "#d73d3d",
      colorRing: "#d97757",
    });
    expect(Object.keys(appearance.variables).sort()).toEqual(["borderRadius", "fontFamily"]);
  });

  it("passes the radius and the sans font, which hold in both modes", () => {
    expect(appearance.variables.borderRadius).toBe("0.5rem");
    expect(appearance.variables.fontFamily).toContain("ui-sans-serif");
    expect(toAppearance(neoBrutalism).variables).toEqual({
      borderRadius: "0px",
      fontFamily: "DM Sans, sans-serif",
    });
  });

  it("passes every foreground explicitly, so that none is derived from a hex the SDK cannot read", () => {
    for (const theme of [claude, neoBrutalism]) {
      for (const mode of MODES) {
        const colours = toAppearance(theme).modes[mode];
        for (const key of [
          "colorPrimaryForeground",
          "colorDestructiveForeground",
          "colorSecondaryForeground",
          "colorAccentForeground",
          "colorMutedForeground",
          "colorCardForeground",
          "colorPopoverForeground",
          "colorForeground",
        ] as const) {
          expect(colours[key], `${mode} ${key}`).toBeTypeOf("string");
        }
      }
    }
  });

  it("derives the hover of the four fills that have one", () => {
    expect(appearance.modes.light).toMatchObject({
      colorPrimaryHover: hoverFor("#b95c3d", "#ffffff"),
      colorSecondaryHover: hoverFor("#e9e6dc", "#535146"),
      colorAccentHover: hoverFor("#e9e6dc", "#28261b"),
      colorDestructiveHover: hoverFor("#141413", "#ffffff"),
    });
  });

  it("moves the colour of a refusal only where the components' own does not read on the theme's surfaces", () => {
    // The components write a refusal in #ea7073 on a dark page and #c91d21 on a light one. On Neo
    // Brutalism's dark card (#333333) the first is 4.25:1, so the theme gets a lighter one.
    const own = { light: "#c91d21", dark: "#ea7073" } as const;
    const dark = toAppearance(neoBrutalism).modes.dark;
    expect(dark.colorDestructiveSubtleForeground).toBeTypeOf("string");
    expect(contrastRatio(own.dark, "#333333")).toBeLessThan(4.5);
    for (const theme of [claude, neoBrutalism]) {
      for (const mode of MODES) {
        const tokens = theme[mode];
        const set = toAppearance(theme).modes[mode].colorDestructiveSubtleForeground;
        for (const surface of [tokens.card!, tokens.background!]) {
          expect(
            contrastRatio(set ?? own[mode], surface),
            `${mode} on ${surface}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    // Where it reads, nothing is set: the components' colour stays the theme package's.
    expect(toAppearance(claude).modes.light.colorDestructiveSubtleForeground).toBeUndefined();
    expect(toAppearance(claude).modes.dark.colorDestructiveSubtleForeground).toBeUndefined();
  });

  it("maps no token the components have no key for", () => {
    const keys = Object.keys({ ...appearance.modes.light, ...appearance.variables }).join(" ");
    expect(keys).not.toMatch(/chart|sidebar|shadow|mono|serif|tracking|spacing/i);
  });

  it("hands the components the classes the storefront's CSS defines", () => {
    expect(appearance.elements).toEqual(THEMED_ELEMENTS);
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    for (const name of new Set(
      Object.values(THEMED_ELEMENTS).flatMap((value) => value.split(" ")),
    )) {
      expect(css, name).toContain(`.${name}`);
    }
  });

  it("puts a per-mode radius or font in the modes when the blocks disagree", () => {
    const theme: ShadcnTheme = {
      light: { radius: "4px", "font-sans": "Inter" },
      dark: { radius: "8px", "font-sans": "Inter" },
    };
    const mapped = toAppearance(theme);
    expect(mapped.variables).toEqual({ fontFamily: "Inter" });
    expect(mapped.modes.light.borderRadius).toBe("4px");
    expect(mapped.modes.dark.borderRadius).toBe("8px");
  });

  it("takes a theme in oklch: colours pass through, hovers come from color-mix", () => {
    const mapped = toAppearance({
      light: {
        primary: "oklch(0.55 0.2 30)",
        "primary-foreground": "oklch(1 0 0)",
        background: "oklch(0.99 0 0)",
      },
      dark: {},
    });
    expect(mapped.modes.light.colorPrimary).toBe("oklch(0.55 0.2 30)");
    expect(mapped.modes.light.colorPrimaryForeground).toBe("oklch(1 0 0)");
    expect(mapped.modes.light.colorPrimaryHover).toBe(
      "color-mix(in srgb, oklch(0.55 0.2 30) 90%, black)",
    );
    expect(mapped.modes.light.colorSecondaryHover).toBeUndefined();
    expect(mapped.modes.dark).toEqual({});
  });

  it("does not change its input", () => {
    const before = JSON.stringify(neoBrutalism);
    toAppearance(neoBrutalism);
    expect(JSON.stringify(neoBrutalism)).toBe(before);
  });
});

describe("the page's tokens", () => {
  for (const { name, adjusted } of THEMES) {
    for (const mode of MODES) {
      it(`${name}, ${mode}: come from the theme, and the brand colour reads as text on the page`, () => {
        const tokens = pageTokens(adjusted[mode], mode);
        expect(tokens).toMatchObject({
          "--bg": adjusted[mode].background,
          "--surface": adjusted[mode].card,
          "--text": adjusted[mode].foreground,
          "--text-muted": adjusted[mode]["muted-foreground"],
          "--border": adjusted[mode].border,
          "--brand": adjusted[mode].primary,
          "--brand-contrast": adjusted[mode]["primary-foreground"],
          "--radius": adjusted[mode].radius,
          "--font": adjusted[mode]["font-sans"],
          "--shadow-sm": adjusted[mode]["shadow-sm"],
        });
        for (const surface of [tokens["--bg"]!, tokens["--surface"]!, tokens["--brand-soft"]!]) {
          expect(contrastRatio(tokens["--brand-text"]!, surface)).toBeGreaterThanOrEqual(4.5);
        }
        expect(
          contrastRatio(tokens["--brand-hover"]!, tokens["--brand-contrast"]!),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("leaves out what the theme does not set", () => {
    expect(pageTokens({ background: "#ffffff" }, "light")).toEqual({ "--bg": "#ffffff" });
  });
});

describe("the stylesheet of the themes", () => {
  const css = paletteStyleSheet(PALETTES);

  it("has a rule for each theme and mode, scoped by the data-palette attribute", () => {
    expect(css).toContain(':root[data-palette="claude"] {');
    expect(css).toContain(':root[data-palette="claude"].dark {');
    expect(css).toContain(':root[data-palette="neo-brutalism"] {');
    expect(css).toContain(':root[data-palette="neo-brutalism"].dark {');
  });

  it("has none for the storefront's own look, and touches no property of the components", () => {
    expect(css).not.toContain('data-palette="kaiten"');
    expect(css).not.toContain("--ktn-");
  });

  it("gives a theme its border width only when it has one", () => {
    const neo = css.slice(css.indexOf('[data-palette="neo-brutalism"]'));
    expect(neo).toContain("--theme-border-width: 2px;");
    expect(css.slice(0, css.indexOf('[data-palette="neo-brutalism"]'))).not.toContain(
      "--theme-border-width",
    );
  });
});

describe("the choice of a theme before the first paint", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

  it("is read by index.html from the same key and for the same themes as the app", () => {
    expect(html).toContain(`"${PALETTE_STORAGE_KEY}"`);
    const themed = PALETTES.filter((palette) => palette.theme).map((palette) => palette.id);
    for (const id of themed) expect(html).toContain(`"${id}"`);
    expect(html).toContain("root.dataset.palette = palette");
  });
});
