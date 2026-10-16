import { glob, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "vite-plus/test";

import {
  assertNoDroppedUtilities,
  classTokens,
  findDroppedUtilities,
} from "../scripts/build-kaiten-css.ts";

// The hand-rolled CSS scanner silently dropped valid utilities (decimal
// spacing like `py-1.5`, single-word utils like `uppercase`), shipping broken
// styles with no build error. These tests pin the build-time guard that now
// fails loudly instead — and prove it does NOT false-positive on prose or SVG
// path data, which the scanner also reads as "tokens".

// Tailwind escapes `.` in generated selectors: `py-1.5` → `.py-1\.5`.
const cssWithRules = [".py-1\\.5{padding:.375rem}", ".gap-1\\.5{gap:.375rem}", ".uppercase{}"].join(
  "\n",
);

test("passes when every used utility produced a rule", () => {
  expect(findDroppedUtilities(cssWithRules, ["py-1.5", "gap-1.5", "uppercase"])).toEqual([]);
});

test("flags a decimal spacing utility that produced no rule", () => {
  // `.py-1\.5` present but `.gap-1\.5` missing from the CSS.
  expect(findDroppedUtilities(".py-1\\.5{}", ["py-1.5", "gap-1.5"])).toEqual(["gap-1.5"]);
});

test("flags a used single-word utility that produced no rule", () => {
  expect(findDroppedUtilities(".flex{}", ["uppercase"])).toEqual(["uppercase"]);
});

test("ignores SVG path fragments that look like decimal utilities", () => {
  // `c-2-2.67`, `l-1.92` come from `d="..."` attributes — not classes.
  expect(findDroppedUtilities("", ["c-2-2.67", "l-1.92", "m1.5"])).toEqual([]);
});

test("ignores prose words that are not utilities", () => {
  expect(findDroppedUtilities("", ["month", "action", "enabled", "none"])).toEqual([]);
});

test("does not let a shorter selector satisfy a longer utility", () => {
  // `.py-1\.5` must NOT be considered emitted just because `.py-1\.500` exists.
  expect(findDroppedUtilities(".py-1\\.500{}", ["py-1.5"])).toEqual(["py-1.5"]);
});

test("treats variant-prefixed utilities as their own (non-bare) token", () => {
  // `has-[>svg]:px-1.5` is not the bare `px-1.5` utility: the guard asks for the variant's own
  // rule, never for a bare `.px-1\.5`.
  const variantRule = ".has-\\[\\>svg\\]\\:px-1\\.5:has(>svg){padding-inline:.375rem}";
  expect(findDroppedUtilities(variantRule, ["has-[>svg]:px-1.5"])).toEqual([]);
});

test("keeps a class whole when its brackets hold an angle bracket or a quote", () => {
  const source = [
    `const a = "h-10 [&>tr]:last:border-b-0 has-[>svg]:px-3";`,
    `const b = cn("[&_svg:not([class*='size-'])]:size-4", "*:[[role=checkbox]]:translate-y-[2px]");`,
    `const c = <div className="[&:has([role=checkbox])]:pr-0 py-1.5">x</div>;`,
  ].join("\n");
  const tokens = classTokens(source);
  for (const cls of [
    "[&>tr]:last:border-b-0",
    "has-[>svg]:px-3",
    "[&_svg:not([class*='size-'])]:size-4",
    "*:[[role=checkbox]]:translate-y-[2px]",
    "[&:has([role=checkbox])]:pr-0",
    "py-1.5",
  ]) {
    expect(tokens).toContain(cls);
  }
  // Outside brackets, quotes and angle brackets still end a token.
  expect(tokens).toContain("h-10");
  expect(tokens).not.toContain("<div");
  expect(tokens.some((token) => token.includes('"'))).toBe(false);
});

test("does not glue an array literal or prose into one token", () => {
  const tokens = classTokens(`const plans = ["CurrentPlan", "security"]; // see [the table] here`);
  expect(tokens).toContain("CurrentPlan");
  expect(tokens.some((token) => token.includes(" "))).toBe(false);
});

test("flags a utility behind an arbitrary variant that produced no rule", () => {
  expect(findDroppedUtilities(".flex{}", ["[&>tr]:last:border-b-0", "has-[>svg]:px-3"])).toEqual([
    "[&>tr]:last:border-b-0",
    "has-[>svg]:px-3",
  ]);
  const css = [
    ":is(.\\[\\&\\>tr\\]\\:last\\:border-b-0 > tr):last-child{border-bottom-width:0}",
    ".has-\\[\\>svg\\]\\:px-3:has(>svg){padding-inline:.75rem}",
  ].join("\n");
  expect(findDroppedUtilities(css, ["[&>tr]:last:border-b-0", "has-[>svg]:px-3"])).toEqual([]);
});

test("assertNoDroppedUtilities throws with the offending utilities listed", () => {
  expect(() => assertNoDroppedUtilities(".flex{}", ["py-1.5", "uppercase"])).toThrow(/py-1\.5/);
  expect(() => assertNoDroppedUtilities(".flex{}", ["py-1.5", "uppercase"])).toThrow(/uppercase/);
});

test("assertNoDroppedUtilities is silent when nothing was dropped", () => {
  expect(() => assertNoDroppedUtilities(cssWithRules, ["py-1.5", "gap-1.5"])).not.toThrow();
});

// ── The scanner's own blind spot ────────────────────────────────────────────
//
// The guard above compares "tokens the scanner found" against "utilities the
// build emitted", so it can only see a token the scanner already found. When the
// scanner lost a class string *entirely*, the guard had nothing to compare and
// stayed silent — which is how the hard paywall's dialog shipped with no
// positioning at all. These tests cover the shapes it lost, and the one below
// checks the shipped stylesheet directly, independently of any scanner.

test("flags a fraction utility that produced no rule", () => {
  expect(findDroppedUtilities(".top-1\\/2{}", ["top-1/2", "left-1/2"])).toEqual(["left-1/2"]);
});

test("flags a negative fraction utility that produced no rule", () => {
  expect(findDroppedUtilities("", ["-translate-x-1/2"])).toEqual(["-translate-x-1/2"]);
});

test("flags an arbitrary-value utility that produced no rule", () => {
  expect(findDroppedUtilities("", ["w-[calc(100vw-2rem)]"])).toEqual(["w-[calc(100vw-2rem)]"]);
});

test("does not treat a variant as a required utility", () => {
  // `data-[state=open]:animate-in` carries brackets but is a variant, not an
  // arbitrary value — requiring it would false-positive on every state variant.
  expect(findDroppedUtilities("", ["data-[state=open]:animate-in"])).toEqual([]);
});

test("ignores fraction-shaped tokens that are not utilities", () => {
  // Version ranges and paths turn up in prose and imports.
  expect(findDroppedUtilities("", ["24/7", "and/or", "http://a/1/2"])).toEqual([]);
});

test("assertNoDroppedUtilities names what was dropped", () => {
  expect(() => assertNoDroppedUtilities("", ["top-1/2"])).toThrow(/top-1\/2/);
});

// ── Container queries ───────────────────────────────────────────────────────
//
// The SDK is embedded: it has to lay itself out from the width of the box the host
// gives it, not from the viewport, so container queries are the mechanism the whole
// responsive strategy rests on. They were also the scanner's worst blind spot —
// `@container` carries none of the characters `shouldKeepToken` looks for, so it was
// dropped before Tailwind ever saw it. That failure is silent twice over: no rule is
// emitted, and the guard could not compare a token the scanner never found.

test("flags a named container declaration that produced no rule", () => {
  expect(findDroppedUtilities("", ["@container/ktn"])).toEqual(["@container/ktn"]);
});

test("flags a container variant that produced no rule", () => {
  expect(findDroppedUtilities("", ["@md:flex-row"])).toEqual(["@md:flex-row"]);
});

test("accepts container utilities the stylesheet does carry", () => {
  // Tailwind escapes the `@` and the `/`: `@container/ktn` → `.\@container\/ktn`.
  const css = [
    ".\\@container\\/ktn{container-type:inline-size}",
    ".\\@md\\:flex-row{flex-direction:row}",
    ".\\@container{container-type:inline-size}",
  ].join("\n");
  expect(findDroppedUtilities(css, ["@container/ktn", "@md:flex-row", "@container"])).toEqual([]);
});

test("flags the bare @container when the stylesheet lacks it", () => {
  // The regression that motivated the allowlist entry: dropped by the scanner, so
  // the container was never declared and every variant silently did nothing.
  expect(findDroppedUtilities(".flex{}", ["@container"])).toEqual(["@container"]);
});

test("a named container does not satisfy the bare one", () => {
  // The exact shape of the regression. A file that uses `@container/ktn` everywhere
  // ships `.\@container\/ktn`, and `.\@container` is a prefix of it — so a guard that
  // matched on prefixes would call the bare utility present and stay silent about the
  // one token the scanner actually lost. Verified against real compiled output.
  expect(
    findDroppedUtilities(".\\@container\\/ktn{container-type:inline-size}", ["@container"]),
  ).toEqual(["@container"]);
});

test("guards every container-variant shape Tailwind accepts", () => {
  const used = ["@max-lg:hidden", "@[30rem]:grid-cols-2", "@md/ktn:p-8", "@3xl:gap-10"];
  expect(findDroppedUtilities("", used)).toEqual([...used].sort());
});

test("ignores @-tokens that are not container utilities", () => {
  // JSDoc tags, scoped package names and TS directives all start with `@` and turn
  // up in the prose the scanner reads. Pinning the variant to Tailwind's container
  // scale is what keeps them out — `@param:` is not `@md:`.
  expect(
    findDroppedUtilities("", [
      "@param",
      "@returns",
      "@ts-expect-error",
      "@kaitencloud/react",
      "@storybook/react-vite",
      "@custom-variant",
    ]),
  ).toEqual([]);
});

test("the shipped stylesheet carries every guarded utility src uses", async () => {
  // The end-to-end check, and the one that would have caught the paywall bug:
  // it re-derives the corpus from the sources itself instead of trusting the
  // build's scanner, so a scanner that loses a class string fails here even
  // though the build's own guard — which can only inspect what that same
  // scanner found — would stay silent.
  const srcDir = path.resolve(import.meta.dirname, "../src");
  const tokens = new Set<string>();
  for await (const file of glob("**/*.{ts,tsx}", { cwd: srcDir })) {
    const content = await readFile(path.join(srcDir, file), "utf8");
    // Two readings: the naive split, which cannot lose a quote-delimited string, and the
    // bracket-aware one, which is the only way to see `has-[>svg]:px-3` whole.
    for (const token of content.match(/[^<>"'`\s]+/g) ?? []) tokens.add(token);
    for (const token of classTokens(content)) tokens.add(token);
  }

  const builtCss = await readFile(path.resolve(import.meta.dirname, "../dist/kaiten.css"), "utf8");

  expect(findDroppedUtilities(builtCss, tokens)).toEqual([]);
});
