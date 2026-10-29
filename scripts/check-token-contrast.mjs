#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Fails when a foreground/background token pair used by the components falls
// below the WCAG AA contrast floor, in either theme.
//
// Why this exists as a plain script rather than a browser check:
//
// The Storybook a11y addon (axe, `test: "error"`) already catches contrast
// violations — but only in CI. The same run passes locally, so a token can be
// darkened, reviewed and pushed before anything objects; `--destructive` reached
// main that way and cost a CI round trip. Contrast is pure arithmetic over the
// token values, so it does not need a browser at all. This check is deterministic,
// runs in milliseconds anywhere, and is wired into `pnpm ready`.
//
// It does NOT replace axe. Axe sees the rendered DOM — roles, labels, focus order,
// and contrast against whatever really ended up behind an element. This only sees
// token math. They are complementary.
//
// Pairs are discovered from the source, not hardcoded: every className string
// literal in packages/react-ui/src is scanned, and any `text-<token>` found alongside
// a `bg-<token>[/<alpha>]` in the same literal becomes a pair to verify. A single
// className is a good proxy for "one element". Hardcoding a list instead would
// drift from the components, and an earlier hand-written audit did exactly that —
// it flagged `text-accent on bg-accent/10`, a combination no component renders.
//
// Two documented approximations:
//
//   - `dark:`-prefixed utilities are checked in the dark theme only; every other
//     variant prefix (hover:, focus:, …) is stripped and checked in both. So hover
//     states ARE covered here, which axe cannot do — it only sees the resting DOM.
//   - A `/<alpha>` background is composited over the page canvas. Real nesting can
//     put it over a card or popover instead, so both surfaces are tried and the
//     WORSE ratio is the one enforced. That is deliberately conservative: a
//     component may legitimately be placed on either surface.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The token values come from the published @kaitencloud/theme that packages/react-ui
// pins: the same stylesheet the components inline at build time. Comments are
// dropped first so a brace in prose can never end a block early.
const themeCss = readFileSync(
  createRequire(join(repoRoot, "packages/react-ui/package.json")).resolve(
    "@kaitencloud/theme/global.css",
  ),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const sourceDir = resolve(repoRoot, "packages/react-ui/src");

// WCAG 2.1 AA for normal-size text. Large text is allowed 3:1, but font size is
// not knowable from a class string, so the stricter floor applies throughout.
const AA = 4.5;

// ---------------------------------------------------------------- colour maths

const parseHex = (hex) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
};

const formatHex = (rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

const composite = (fg, bg, alpha) => fg.map((c, i) => Math.round(alpha * c + (1 - alpha) * bg[i]));

const relativeLuminance = (rgb) => {
  const [r, g, b] = rgb.map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (a, b) => {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// ------------------------------------------------------------- token discovery

/** `--name: #rrggbb;` declarations from one selector block. Non-colour tokens are skipped. */
function readTokens(selector) {
  const tokens = new Map();
  const start = themeCss.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`@kaitencloud/theme/global.css has no "${selector} {" block`);
  const contents = themeCss.slice(start, themeCss.indexOf("}", start));
  for (const line of contents.split("\n")) {
    const match = /^--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/.exec(line.trim());
    if (match) tokens.set(match[1], parseHex(match[2]));
  }
  return tokens;
}

const THEMES = [
  { name: "light", tokens: readTokens(":root") },
  { name: "dark", tokens: readTokens(".dark") },
];

// ------------------------------------------------------------- source scanning

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

// Literal colour utilities, checked alongside the tokens.
//
// A hardcoded `text-white` looks harmless and is invisible to a token-only scan, so
// it survives a theme change that the tokens follow. That is exactly how the
// destructive button broke: its label was `text-white`, and when the dark fill moved
// to a light red paired with a dark foreground, the button alone kept white text at
// 3.25:1 while every token-driven surface stayed compliant.
const LITERAL_COLORS = { white: [255, 255, 255], black: [0, 0, 0] };

// Longest-first so `muted-foreground` wins over `muted`.
const tokenNames = [...THEMES[0].tokens.keys(), ...Object.keys(LITERAL_COLORS)].sort(
  (a, b) => b.length - a.length,
);
const alternatives = tokenNames.join("|");
const CLASS_STRING = /(["'`])((?:[^"'`\\\n]|\\.)*)\1/g;
const TEXT_UTILITY = new RegExp(`(?:^|\\s)((?:[\\w-]+:)*)text-(${alternatives})(?![\\w-])`, "g");
const BG_UTILITY = new RegExp(
  `(?:^|\\s)((?:[\\w-]+:)*)bg-(${alternatives})(?:/(\\d+))?(?![\\w-])`,
  "g",
);

// Variants that render a SEPARATE box with its own background. Two different ones
// never coexist, so their utilities must not be paired with each other — without
// this, `input.tsx` alone yields `selection:text-primary-foreground` over the input's
// own `bg-background` (white on white, 1.00:1) and two more phantom pairs.
// Everything else (hover:, focus:, aria-*:, dark:, breakpoints) restyles the same
// box, so those DO pair — which is how hover states get covered here at all.
const PSEUDO_ELEMENTS = new Set([
  "before",
  "after",
  "placeholder",
  "file",
  "marker",
  "selection",
  "first-line",
  "first-letter",
  "backdrop",
]);

const pseudoElementOf = (variantChain) =>
  variantChain
    .split(":")
    .filter(Boolean)
    .find((variant) => PSEUDO_ELEMENTS.has(variant)) ?? "";

/** Every (foreground, background) pair implied by one className literal. */
function pairsInClassString(value) {
  const foregrounds = [...value.matchAll(TEXT_UTILITY)].map((m) => ({
    token: m[2],
    pseudo: pseudoElementOf(m[1]),
    darkOnly: m[1].includes("dark:"),
  }));
  const backgrounds = [...value.matchAll(BG_UTILITY)].map((m) => ({
    token: m[2],
    alpha: m[3] === undefined ? 1 : Number(m[3]) / 100,
    pseudo: pseudoElementOf(m[1]),
    darkOnly: m[1].includes("dark:"),
  }));

  const pairs = [];
  for (const fg of foregrounds) {
    for (const bg of backgrounds) {
      // A pseudo-element's text sits on that pseudo-element's own background. When
      // it declares none with a theme token, its effective backdrop is unknowable
      // from the class string alone, so the pair is skipped rather than guessed.
      if (fg.pseudo !== bg.pseudo) continue;
      // `text-X` over `bg-X/n` is ~1:1 by construction, so nobody writes it expecting
      // the two to contrast: the element sits on a surface this scan cannot see,
      // typically an inverted one like a tooltip. Reporting it is never actionable.
      if (fg.token === bg.token) continue;
      pairs.push({
        fg: fg.token,
        bg: bg.token,
        alpha: bg.alpha,
        darkOnly: fg.darkOnly || bg.darkOnly,
      });
    }
  }
  return pairs;
}

const found = new Map();
for (const file of walk(sourceDir)) {
  if (file.includes(".stories.")) continue;
  const contents = readFileSync(file, "utf8");
  for (const [, , literal] of contents.matchAll(CLASS_STRING)) {
    for (const pair of pairsInClassString(` ${literal} `)) {
      const key = `${pair.fg}|${pair.bg}|${pair.alpha}|${pair.darkOnly}`;
      if (!found.has(key)) found.set(key, { ...pair, file: relative(repoRoot, file) });
    }
  }
}

// ------------------------------------------------------------------- the check

// Pairs already below AA when this check was introduced. They are real WCAG 1.4.3
// failures, not false positives — every one is a `hover:` state whose translucent
// fill composites toward the page and loses contrast against its own foreground.
// Fixing them means redesigning those hover states, which is a design decision;
// they are recorded here so the check can gate NEW regressions today rather than
// waiting on that. axe never reported them: it only ever sees the resting DOM.
//
// Removing an entry is the goal. A stale entry (one whose pair now passes) fails
// the check, so this list cannot quietly outlive the problem it documents.
const KNOWN_BELOW_AA = new Map([]);

const keyOf = (r) => `${r.theme}|text-${r.fg}|bg-${r.bg}`;

const failures = [];
const accepted = new Set();
const checked = [];

for (const pair of found.values()) {
  for (const theme of THEMES) {
    if (pair.darkOnly && theme.name !== "dark") continue;
    // Literals resolve the same in both themes; tokens vary by theme.
    const fg = theme.tokens.get(pair.fg) ?? LITERAL_COLORS[pair.fg];
    const bg = theme.tokens.get(pair.bg) ?? LITERAL_COLORS[pair.bg];
    if (!fg || !bg) continue;

    // A translucent fill sits on whatever surface hosts it; enforce the worse case.
    const surfaces =
      pair.alpha === 1
        ? [bg]
        : ["background", "card"]
            .map((name) => theme.tokens.get(name))
            .filter(Boolean)
            .map((surface) => composite(bg, surface, pair.alpha));

    for (const surface of surfaces) {
      const ratio = contrastRatio(fg, surface);
      const record = {
        theme: theme.name,
        fg: pair.fg,
        bg: pair.alpha === 1 ? pair.bg : `${pair.bg}/${Math.round(pair.alpha * 100)}`,
        surface: formatHex(surface),
        ratio,
        file: pair.file,
      };
      // The same pair reaches us from several className literals; report it once,
      // keeping the worst surface.
      const seen = checked.find((c) => keyOf(c) === keyOf(record));
      if (seen) {
        if (record.ratio < seen.ratio) Object.assign(seen, record);
        continue;
      }
      checked.push(record);
    }
  }
}

for (const record of checked) {
  if (record.ratio >= AA) continue;
  if (KNOWN_BELOW_AA.has(keyOf(record))) accepted.add(keyOf(record));
  else failures.push(record);
}

// An accepted pair that now clears AA means the list outlived its reason.
const stale = [...KNOWN_BELOW_AA.keys()].filter(
  (key) => !accepted.has(key) && checked.some((r) => keyOf(r) === key),
);

const describe = (r) =>
  `${r.theme.padEnd(5)} text-${r.fg} on bg-${r.bg} (${r.surface})  ${r.ratio.toFixed(2)}:1`;

if (process.env.VERBOSE) {
  for (const record of [...checked].sort((a, b) => a.ratio - b.ratio)) {
    const mark = record.ratio >= AA ? "ok  " : KNOWN_BELOW_AA.has(keyOf(record)) ? "know" : "FAIL";
    console.log(`  ${mark} ${describe(record)}`);
  }
}

if (stale.length > 0) {
  console.error(
    `✗ ${stale.length} entr(y/ies) in KNOWN_BELOW_AA now meet AA — delete them from\n` +
      `  scripts/check-token-contrast.mjs so the list keeps meaning something:\n\n` +
      stale.map((key) => `  ${key}  (${KNOWN_BELOW_AA.get(key)})`).join("\n"),
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error(
    `✗ ${failures.length} token pair(s) below WCAG AA ${AA}:1\n\n` +
      failures
        .sort((a, b) => a.ratio - b.ratio)
        .map((r) => `  ${describe(r)}\n      used in ${r.file}`)
        .join("\n") +
      `\n\nAdjust the pairing, or the token in @kaitencloud/theme.\n` +
      `Run with VERBOSE=1 to print every pair that was checked.`,
  );
  process.exit(1);
}

const suffix =
  accepted.size > 0 ? `, ${accepted.size} known exception(s) still below AA (see the list)` : "";
console.log(
  `✓ ${checked.length} token pair(s) from ${found.size} className combination(s) ` +
    `meet WCAG AA ${AA}:1${suffix}`,
);
