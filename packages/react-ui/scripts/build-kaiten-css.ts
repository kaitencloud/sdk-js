import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { compile } from "tailwindcss";

import { assertScoped, assertUnlayered, scopeKaitenCss } from "./scope-kaiten-css.ts";

// A class token is a run of ordinary characters and bracketed groups. Outside brackets a
// token stops at whitespace, a quote, a backtick or an angle bracket, which separate class
// names in source. Inside brackets those characters belong to the class: `has-[>svg]:px-3`,
// `[&>tr]:last:border-b-0`, `[&_svg:not([class*='size-'])]:size-4`. Splitting there used to cut
// each of these in two, so none of them reached the published stylesheet, while Storybook
// (Tailwind's own scanner) still drew them. A bracket group may hold one nested group and
// never whitespace, which keeps array literals and prose from being glued into one token.
const CLASS_TOKEN = /(?:\[(?:[^[\]\s]|\[[^[\]\s]*\])*\]|[^<>"'`\s[])+/g;

// A spacing/sizing utility carrying a decimal step, e.g. `py-1.5`, `gap-1.5`,
// `size-2.5`. The prefix is gated to a known set so this does NOT match SVG path
// fragments that look similar (`c-2-2.67`, `l-1.92` from a `d="..."` attribute) —
// the scanner reads whole files, so path data shows up as "tokens".
// These are exactly the utilities the old hand-rolled `.`-branch dropped silently.
const DECIMAL_SPACING_UTILITY =
  /^-?(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy]|size|w|h|min-[wh]|max-[wh]|top|bottom|left|right|inset(?:-[xy])?|translate-[xy]|scale(?:-[xy])?|basis|leading|text)-\d+\.\d+$/;

// A fraction utility (`top-1/2`, `w-2/3`, `-translate-x-1/2`) and an arbitrary
// value (`w-[calc(100vw-2rem)]`, `top-[50%]`). Both shapes are structurally
// unmistakable — prose and SVG path data cannot produce them — so a token that
// looks like one and produced no rule is a genuine silent drop, never a false
// positive. They are guarded because they are the shapes the *scanner* is most
// likely to lose, which is exactly what happened to the hard paywall's dialog.
const FRACTION_UTILITY = /^-?[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+\/\d+$/;
const ARBITRARY_UTILITY = /^-?[a-z][a-z0-9-]*-\[[^\]]+\]$/;

// A utility behind a bracketed variant whose brackets hold `>` or a quote: `[&>tr]:last:border-b-0`,
// `has-[>svg]:px-3`, `[&_svg:not([class*='size-'])]:size-4`. These are exactly the classes the
// scanner used to cut in two on those characters. Variants with plain brackets
// (`data-[state=open]:animate-in`) stay unguarded: their utility may be one this stylesheet
// does not define, and the scanner never lost them. The part after the variant must look like a
// utility, so a selector string such as `[tabindex]:not([tabindex="-1"])` is not one.
const BRACKETED_VARIANT_UTILITY =
  /^(?:\*:)?(?:[a-z][a-z0-9-]*-)?(\[(?:[^[\]\s]|\[[^[\]\s]*\])*\]):(?:[a-z][a-z0-9-]*:)*-?[a-z][a-z0-9-]*(?:-\[[^\s\]]+\]|\.\d+)?$/;

function isLostVariantUtility(token: string): boolean {
  const match = BRACKETED_VARIANT_UTILITY.exec(token);
  return match !== null && /[>'"]/.test(match[1]);
}

// A container-query utility: the named container declaration (`@container/ktn`) and
// any container variant (`@md:flex-row`, `@max-lg:hidden`, `@[30rem]:grid-cols-2`,
// `@md/ktn:p-8`). The variant name is pinned to Tailwind's own container scale rather
// than `[a-z0-9]+`, so a JSDoc tag or a scoped package name can never be mistaken for
// one. The bare `@container` carries no separator at all and so lives in
// GUARDED_SINGLE_WORD with the other bare utilities.
//
// Guarded for the same reason fractions are: these are shapes the *scanner* loses.
// `@container` on its own contains none of the characters `shouldKeepToken` looks for
// (`-`, `:`, `[`, `/`), so before it was allowlisted it never reached Tailwind — the
// container was never declared, every `@`-variant in the file fell back to its base
// style, and nothing failed. That is the silent drop this whole guard exists to catch,
// and it is invisible in a way the paywall bug was not: the classes are all still in
// the markup, so the only symptom is a layout that quietly ignores its container.
const CONTAINER_SCALE = "(?:3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)";
const CONTAINER_UTILITY = new RegExp(
  "^@(?:" +
    // `@container/ktn` — the named declaration. Bare `@container` is a single word.
    "container\\/[A-Za-z0-9_-]+" +
    "|" +
    // `@md:…`, `@max-lg:…`, `@[30rem]:…`, optionally naming a container: `@md/ktn:…`
    `(?:\\[[^\\]]+\\]|(?:min-|max-)?${CONTAINER_SCALE})(?:\\/[A-Za-z0-9_-]+)?:\\S+` +
    ")$",
);

// Bare single-word utilities (no separator) that the allowlist must carry. The
// scanner can't tell these apart from prose ("none", "month", "error"…), so they
// are enumerated rather than pattern-matched. Keep in sync with the allowlist.
const GUARDED_SINGLE_WORD = new Set([
  // The un-named container declaration. Prefer `@container/ktn` in components — a
  // named container is what lets a nested widget query its own box rather than its
  // nearest ancestor's — but the bare form is a real utility and has to be carried,
  // because a token the allowlist drops is a token this guard can never see.
  "@container",
  "truncate",
  "uppercase",
  "lowercase",
  "capitalize",
  "italic",
  "underline",
  "invisible",
  "isolate",
  "fixed",
  "rounded",
  "antialiased",
]);

const SIMPLE_UTILITY_ALLOWLIST = new Set([
  "@container",
  "absolute",
  "animate-spin",
  "antialiased",
  "article",
  "backdrop-blur-sm",
  "block",
  "border",
  "capitalize",
  "contents",
  "dark",
  "fixed",
  "flex",
  "grid",
  "hidden",
  "inline-flex",
  "invisible",
  "isolate",
  "italic",
  "items-center",
  "justify-between",
  "justify-center",
  "lowercase",
  "relative",
  "rounded",
  "shadow",
  "space-y-1",
  "space-y-2",
  "sticky",
  "table",
  "text-left",
  "truncate",
  "underline",
  "uppercase",
  "w-full",
]);

function shouldKeepToken(token: string): boolean {
  if (!token) return false;
  if (token.startsWith("http")) return false;
  if (token.includes("${")) return false;
  // Tokens with a `.`: keep arbitrary values (`bg-[#fff]`), variants, fractions —
  // AND decimal-step utilities (`py-1.5`). The old code dropped the last group,
  // which silently zeroed out padding/gap (the badge-padding bug). Being generous
  // here is safe: Tailwind emits nothing for a token that isn't a real utility.
  if (token.includes(".")) {
    return (
      token.includes("/") ||
      token.includes("[") ||
      token.includes(":") ||
      /^-?[a-z][a-z-]*-\d/.test(token)
    );
  }

  return (
    SIMPLE_UTILITY_ALLOWLIST.has(token) ||
    /[-:[\]()%/]/.test(token) ||
    token.startsWith("data-[") ||
    token.startsWith("aria-[")
  );
}

/**
 * Tailwind escapes `.`, `/`, `:` etc. in generated selectors (`.py-1\.5`). `@` is in
 * that set too — `@container/ktn` ships as `.\@container\/ktn` — and leaving it out
 * did not merely weaken the guard, it inverted it: every container-query utility
 * looked absent from a stylesheet that in fact carried it.
 */
function selectorFor(util: string): string {
  // Tailwind escapes every character outside [A-Za-z0-9_-] in a class selector: `.`, `/`, `:`,
  // `@`, and in arbitrary variants `&`, `>`, `=`, `*`, `'` too (`.has-\[\>svg\]\:px-3`).
  return "." + util.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`);
}

function cssEmitsUtility(css: string, util: string): boolean {
  const selector = selectorFor(util);
  let from = 0;
  for (;;) {
    const idx = css.indexOf(selector, from);
    if (idx === -1) return false;
    // Ensure this is a whole selector, not a prefix of a longer class
    // (`.py-1\.5` must not be satisfied by `.py-1\.500`). A real class continues
    // with a class-name char or an escaped special.
    const next = css[idx + selector.length];
    if (next === undefined || !/[\w\\-]/.test(next)) return true;
    from = idx + selector.length;
  }
}

/**
 * Returns the utilities that are used in `src` but produced NO rule in the built
 * CSS — i.e. silently dropped on the way. Restricted to structurally
 * identifiable, false-positive-free shapes (all intersected with what `src`
 * actually uses), so prose and SVG path data never trigger a false violation:
 * decimal spacing utilities, fractions, arbitrary values, container-query
 * utilities, and an explicit single-word allowlist.
 */
export function findDroppedUtilities(builtCss: string, rawTokens: Iterable<string>): string[] {
  const used = new Set(rawTokens);
  const required = new Set<string>();
  for (const token of used) {
    if (DECIMAL_SPACING_UTILITY.test(token)) required.add(token);
    if (FRACTION_UTILITY.test(token)) required.add(token);
    if (ARBITRARY_UTILITY.test(token)) required.add(token);
    if (isLostVariantUtility(token)) required.add(token);
    if (CONTAINER_UTILITY.test(token)) required.add(token);
    if (GUARDED_SINGLE_WORD.has(token)) required.add(token);
  }
  return [...required].filter((util) => !cssEmitsUtility(builtCss, util)).sort();
}

/** Fails the build (rather than shipping a broken stylesheet) on a silent drop. */
export function assertNoDroppedUtilities(builtCss: string, rawTokens: Iterable<string>): void {
  const dropped = findDroppedUtilities(builtCss, rawTokens);
  if (dropped.length > 0) {
    throw new Error(
      `build-kaiten-css: ${dropped.length} utilit${dropped.length === 1 ? "y is" : "ies are"} ` +
        `used in src but produced no CSS rule (silent drop — fix shouldKeepToken / the ` +
        `allowlist in build-kaiten-css.ts): ${dropped.join(", ")}`,
    );
  }
}

/** The class-name tokens the scanner reads from one source file. */
export function classTokens(content: string): string[] {
  return content.match(CLASS_TOKEN) ?? [];
}

async function resolveStylesheet(id: string, base: string) {
  const resolvedUrl =
    id.startsWith(".") || id.startsWith("/")
      ? pathToFileURL(path.resolve(base, id)).href
      : resolvePackage(id, "index.css");
  const resolvedPath = fileURLToPath(resolvedUrl);
  const content = (await readFile(resolvedPath, "utf8")).toString();

  return {
    path: resolvedPath,
    base: path.dirname(resolvedPath),
    content,
  };
}

async function resolveModule(id: string, base: string) {
  const resolvedUrl =
    id.startsWith(".") || id.startsWith("/")
      ? pathToFileURL(path.resolve(base, id)).href
      : resolvePackage(id);
  const resolvedPath = fileURLToPath(resolvedUrl);
  const module = await import(resolvedUrl);

  return {
    path: resolvedPath,
    base: path.dirname(resolvedPath),
    module: module.default ?? module,
  };
}

function resolvePackage(id: string, suffix = ""): string {
  try {
    return import.meta.resolve(suffix ? `${id}/${suffix}` : id);
  } catch {
    return import.meta.resolve(id);
  }
}

async function collectCandidates(
  sourcePatterns: Array<{ base: string; pattern: string; negated: boolean }>,
): Promise<{ candidates: string[]; rawTokens: Set<string> }> {
  const candidates = new Set<string>();
  const rawTokens = new Set<string>();

  for (const source of sourcePatterns) {
    if (source.negated) continue;

    for await (const file of glob(source.pattern, { cwd: source.base })) {
      const absolute = path.resolve(source.base, file);
      const content = (await readFile(absolute, "utf8")).toString();

      // Tokenise the WHOLE file, not quote-delimited literals.
      //
      // Pairing quotes with a regex cannot tell a string delimiter from an
      // apostrophe in prose. One `can't` in a comment shifts every pairing after
      // it, and from there the file is read half-inverted: what was inside a
      // string is treated as outside and vice versa. `paywall.tsx` had seven
      // apostrophes — an odd number — before its hard-dialog className, so that
      // entire class list was invisible and the dialog shipped with no
      // positioning at all. It survived review because the classes it lost
      // (`top-1/2`, the translates) happened to be emitted by the host app that
      // was testing it.
      //
      // Scanning raw content is a strict superset: it can only add candidates.
      // Most of the noise it lets in — SVG path fragments, prose that is not a
      // utility — costs nothing, because Tailwind emits nothing for a token that
      // is not a real utility.
      //
      // The exception is the single-word allowlist, and it is worth knowing about:
      // `contents`, `block`, `table`, `fixed`, `flex`, `grid`, `border`, `rounded`
      // and `shadow` are all ordinary English words AND real utilities, so writing
      // one in a comment ships its rule. Observed, not theorised — a doc comment
      // containing the phrase "look at my contents" added
      // `.contents{display:contents}` to the published stylesheet.
      //
      // The cost is a few dead rules, so this is a note rather than a defect: the
      // alternative is pairing quotes, which is what broke the paywall above. If it
      // ever matters, prefer the singular in prose ("content"), which is not one.
      for (const token of classTokens(content)) {
        rawTokens.add(token);
        if (shouldKeepToken(token)) {
          candidates.add(token);
        }
      }
    }
  }

  return { candidates: Array.from(candidates), rawTokens };
}

export async function buildKaitenCss(outDir: string): Promise<void> {
  const cssPath = path.resolve("src/styles/kaiten.css");
  const css = (await readFile(cssPath, "utf8")).toString();

  const compiler = await compile(css, {
    base: path.dirname(cssPath),
    from: cssPath,
    loadStylesheet: resolveStylesheet,
    loadModule: resolveModule,
  });

  const { candidates, rawTokens } = await collectCandidates(compiler.sources);
  const builtCss = compiler.build(candidates);

  // Guard: the hand-rolled scanner has historically dropped valid utilities
  // (decimals, single-word utils) with no build error, shipping broken CSS. Fail
  // loudly instead — this is the safety net the team chose over a full Tailwind
  // rebuild.
  assertNoDroppedUtilities(builtCss, rawTokens);

  // Tailwind emits utilities and preflight at document scope, so the package
  // used to ship `.bg-primary` &c. straight into the host's cascade. Confine
  // everything generated to the `.kaiten` subtree before writing — and, that done,
  // dissolve the layers, which are what kept the scope from winning inside itself.
  const scopedCss = scopeKaitenCss(builtCss);
  assertScoped(scopedCss);
  assertUnlayered(scopedCss);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "kaiten.css"), scopedCss, "utf8");
}
