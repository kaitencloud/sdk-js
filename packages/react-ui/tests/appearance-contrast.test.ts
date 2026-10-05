import { describe, expect, test } from "vite-plus/test";

import { resolveVariables } from "../src/appearance/apply.ts";
import { themes } from "../src/appearance/themes.ts";
import type { KaitenAppearance } from "../src/appearance/types.ts";

// Contrast for the *theme token files* is checked by scripts/check-token-contrast.mjs.
// That script reads CSS, so it cannot see these presets — they are TypeScript values,
// and they only become colours after `resolveVariables` runs. Two shipped this way
// below WCAG AA: `emerald` put white on #059669 (3.77:1) and `ocean` white on #0ea5e9
// (2.77:1), because a preset overrides a fill without the text colour on it.
//
// The same hole is open to consumers: `appearance.variables` is the documented way to
// apply a brand colour, and a light brand would have broken every button the same way.

const AA = 4.5;

function parseHex(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  if (!match) throw new Error(`expected a 6-digit hex colour, got ${color}`);
  return [match[1]!, match[2]!, match[3]!].map((c) => Number.parseInt(c, 16)) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Fill variable → the text variable that lands on it. */
const PAIRS: [string, string][] = [
  ["--ktn-primary", "--ktn-primary-foreground"],
  ["--ktn-destructive", "--ktn-destructive-foreground"],
  ["--ktn-success", "--ktn-success-foreground"],
  ["--ktn-secondary", "--ktn-secondary-foreground"],
  ["--ktn-accent", "--ktn-accent-foreground"],
  ["--ktn-card", "--ktn-card-foreground"],
  ["--ktn-popover", "--ktn-popover-foreground"],
  ["--ktn-background", "--ktn-foreground"],
];

function pairsIn(variables: KaitenAppearance["variables"]): [string, number][] {
  const style = resolveVariables(variables);
  const results: [string, number][] = [];
  for (const [fill, foreground] of PAIRS) {
    const fillValue = style?.[fill];
    const foregroundValue = style?.[foreground];
    // Pairs the preset leaves untouched keep the theme's own values, which
    // check-token-contrast.mjs already gates.
    if (!fillValue || !foregroundValue) continue;
    results.push([`${foreground} on ${fill}`, contrast(foregroundValue, fillValue)]);
  }
  return results;
}

describe("appearance presets keep text readable on the fills they override", () => {
  for (const [name, preset] of Object.entries(themes)) {
    test(`${name} meets WCAG AA on every pair it sets`, () => {
      // Each mode is checked as it will actually render: a preset's surfaces
      // live under `modes` now, and a pair split across `variables` and a mode
      // (brand fill here, page text there) only exists once they are merged.
      const palettes = [
        preset.variables,
        { ...preset.variables, ...(preset as { modes?: { light?: object } }).modes?.light },
        { ...preset.variables, ...(preset as { modes?: { dark?: object } }).modes?.dark },
      ];

      for (const palette of palettes) {
        for (const [label, ratio] of pairsIn(palette)) {
          expect(`${name} ${label}: ${ratio.toFixed(2)}:1`).toBe(
            `${name} ${label}: ${Math.max(ratio, AA).toFixed(2)}:1`,
          );
        }
      }
    });
  }
});

describe("an overridden fill stays legible without its foreground", () => {
  test("a light brand colour gets dark text rather than the inherited white", () => {
    const style = resolveVariables({ colorPrimary: "#7dd3fc" });
    expect(style["--ktn-primary-foreground"]).toBe("#000000");
    expect(contrast(style["--ktn-primary-foreground"]!, "#7dd3fc")).toBeGreaterThanOrEqual(AA);
  });

  test("a dark brand colour gets white text", () => {
    const style = resolveVariables({ colorPrimary: "#1e1b4b" });
    expect(style["--ktn-primary-foreground"]).toBe("#ffffff");
  });

  test("an explicit foreground is never second-guessed", () => {
    const style = resolveVariables({
      colorPrimary: "#7dd3fc",
      colorPrimaryForeground: "#123456",
    });
    expect(style["--ktn-primary-foreground"]).toBe("#123456");
  });

  test("a fill nobody overrode is left to the theme", () => {
    const style = resolveVariables({ colorPrimary: "#1e1b4b" });
    expect(style["--ktn-card-foreground"]).toBeUndefined();
    expect(style["--ktn-destructive-foreground"]).toBeUndefined();
  });

  test("an overridden fill takes its hover with it, still meeting AA", () => {
    const style = resolveVariables({ colorPrimary: "#7dd3fc" });
    const hover = style["--ktn-primary-hover"]!;
    // Not the theme's default purple, and not the fill itself.
    expect(hover).not.toBe("#7dd3fc");
    expect(hover.toLowerCase()).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrast(style["--ktn-primary-foreground"]!, hover)).toBeGreaterThanOrEqual(AA);
  });

  test("an explicit hover is never second-guessed", () => {
    const style = resolveVariables({
      colorPrimary: "#7dd3fc",
      colorPrimaryHover: "#0369a1",
    });
    expect(style["--ktn-primary-hover"]).toBe("#0369a1");
  });

  test("a colour we cannot parse yields no guess", () => {
    const style = resolveVariables({ colorPrimary: "oklch(0.7 0.15 250)" }) as Record<
      string,
      string
    >;
    expect(style["--ktn-primary"]).toBe("oklch(0.7 0.15 250)");
    expect(style["--ktn-primary-foreground"]).toBeUndefined();
  });
});
