// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

/**
 * The gradient CTA is the one place in the SDK where a fill is not a flat token, so
 * neither of the two contrast gates can see it: `scripts/check-token-contrast.mjs`
 * pairs solid tokens, and `appearance-contrast.test.ts` resolves preset variables.
 * A gradient has a contrast ratio at every point along its length, and only the
 * WORST one matters.
 *
 * Two separate requirements ride on it:
 *
 *  - the label, white on the fill — WCAG 1.4.3, 4.5:1. The raw brand gradient ends
 *    on #fc6b27 at 2.89:1, which is why `.ktn-cta-gradient` scrims its second half.
 *  - the focus ring, which paints that fill LIFTED by a flat white veil, where
 *    card surface was — WCAG 2.4.11, 3:1 between the focused and unfocused
 *    pixels. It carries no text, so it is not bound by the label's scrim; the
 *    veil is what lets one ring clear 3:1 against both the white card and the
 *    dark one, which neither the raw nor the scrimmed gradient does.
 *
 * Both are measured here against the real values parsed out of the shipped
 * stylesheet, so a change to `--primary-gradient`, to the scrim, or to `--card`
 * fails HERE rather than in someone's browser.
 */

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

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb;
}

/** Composite `colour` at `alpha` over `backdrop` — how the scrim reaches the eye. */
function over(colour: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return mix(backdrop, colour, alpha);
}

interface Stop {
  position: number;
  colour: Rgb;
}

/** `#5c44fc 0%, #7640d1 33%, …` → ordered stops. */
function parseStops(gradient: string): Stop[] {
  const stops = [...gradient.matchAll(/(#[0-9a-f]{6})\s+(\d+)%/gi)].map((match) => ({
    position: Number(match[2]) / 100,
    colour: parseHex(match[1]!),
  }));
  if (stops.length < 2) throw new Error(`expected a multi-stop gradient, got: ${gradient}`);
  return stops;
}

/** `rgba(0, 0, 0, 0) 0%, … rgba(0, 0, 0, 0.3) 100%` → the scrim's alpha ramp. */
function parseAlphaStops(gradient: string): { position: number; alpha: number }[] {
  const stops = [...gradient.matchAll(/rgba\(0,\s*0,\s*0,\s*([\d.]+)\)\s+(\d+)%/gi)].map(
    (match) => ({ position: Number(match[2]) / 100, alpha: Number(match[1]) }),
  );
  if (!stops.length) throw new Error(`no scrim stops in: ${gradient}`);
  return stops;
}

function colourAt(stops: Stop[], position: number): Rgb {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (position >= a.position && position <= b.position) {
      const span = b.position - a.position;
      return mix(a.colour, b.colour, span === 0 ? 0 : (position - a.position) / span);
    }
  }
  return stops[stops.length - 1]!.colour;
}

function alphaAt(stops: { position: number; alpha: number }[], position: number): number {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (position >= a.position && position <= b.position) {
      const span = b.position - a.position;
      return a.alpha + (b.alpha - a.alpha) * (span === 0 ? 0 : (position - a.position) / span);
    }
  }
  return stops[stops.length - 1]!.alpha;
}

/** The 101 colours the eye actually meets across the button, scrim included. */
function renderedFill(brand: Stop[], scrim: { position: number; alpha: number }[]): Rgb[] {
  return Array.from({ length: 101 }, (_, step) => {
    const position = step / 100;
    return over([0, 0, 0], alphaAt(scrim, position), colourAt(brand, position));
  });
}

function worstContrast(samples: Rgb[], against: Rgb): number {
  return samples.reduce((worst, sample) => Math.min(worst, contrast(sample, against)), Infinity);
}

describe("the gradient CTA", () => {
  const css = readBuiltCss();

  // Parsed from the shipped stylesheet, never restated here — the point is that
  // these assertions track the real values.
  const brandMatch =
    /--ktn-primary-gradient:\s*var\([^,]+,\s*(linear-gradient\([^)]*\)[^;]*)\)/.exec(css);
  const brand = parseStops(brandMatch?.[1] ?? "");

  const fillMatch =
    /--ktn-cta-fill:\s*(linear-gradient\(90deg,[^;]*?\))\s*,\s*var\(--ktn-primary-gradient\)/.exec(
      css,
    );
  const scrim = parseAlphaStops(fillMatch?.[1] ?? "");

  const samples = renderedFill(brand, scrim);

  // The ring's veil, parsed rather than restated — same rule as the scrim above.
  const veilMatch = /--ktn-cta-ring:\s*linear-gradient\(rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/.exec(
    css,
  );
  if (!veilMatch) throw new Error("no --ktn-cta-ring veil in the built stylesheet");
  const veil = Number(veilMatch[1]);
  const ringSamples = samples.map((sample) => over([255, 255, 255], veil, sample));

  const CARD_DARK = parseHex("#222327");
  const CARD_LIGHT = parseHex("#ffffff");
  const CARD_LIGHT_TINTED = parseHex("#f8fafc");
  const WHITE = parseHex("#ffffff");

  test("its label clears WCAG AA at every point of the fill", () => {
    // The unscrimmed gradient is what fails: white on #fc6b27 is 2.89:1.
    expect(worstContrast(samples, WHITE)).toBeGreaterThanOrEqual(4.5);
  });

  test("the raw brand gradient would NOT clear it — the scrim is load-bearing", () => {
    const unscrimmed = Array.from({ length: 101 }, (_, step) => colourAt(brand, step / 100));
    expect(worstContrast(unscrimmed, WHITE)).toBeLessThan(4.5);
  });

  test("its focus ring clears WCAG 2.4.11 on every surface it lands on", () => {
    // The ring paints the lifted fill where card surface was, so focused-vs-
    // unfocused is ring-vs-card. 3:1 is the floor, and the margins are deliberately
    // balanced across the three: ~3.66 dark, ~3.89 white, ~3.71 tinted.
    for (const card of [CARD_DARK, CARD_LIGHT, CARD_LIGHT_TINTED]) {
      expect(worstContrast(ringSamples, card)).toBeGreaterThanOrEqual(3);
    }
  });

  test("the veil is load-bearing — the unlifted fill would fail the dark card", () => {
    // Guards the reason the veil exists. Without it the scrimmed gradient sits at
    // 2.56:1 against #222327, which is how this was found in the first place.
    expect(worstContrast(samples, CARD_DARK)).toBeLessThan(3);
  });

  test("the ring is derived from the fill, not restated beside it", () => {
    // The ring is no longer the fill verbatim — it is the fill plus a veil — but it
    // must still be BUILT from it. Restating the gradient here is what would let the
    // ring pass its own gate while no longer looking like the button, and it is also
    // what would break hover, which moves both by reassigning `--ktn-cta-fill` alone.
    expect(css).toMatch(/--ktn-cta-ring:[^;]*var\(--ktn-cta-fill\)/);
    expect(css).toContain("background-image: var(--ktn-cta-fill)");
    expect(css).toContain("background-image: var(--ktn-cta-ring)");
    expect(css.match(/background-image:\s*var\(--ktn-cta-(?:fill|ring)\)/g)?.length).toBe(2);
  });
});
