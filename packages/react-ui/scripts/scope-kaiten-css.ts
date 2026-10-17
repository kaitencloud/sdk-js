// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  type Document as PostcssDocument,
  type Rule,
} from "postcss";

/**
 * Matches the SDK root and everything inside it.
 *
 * `:is()` rather than `:where()` on purpose. `:where()` contributes no
 * specificity, so a host stylesheet loaded after ours would win *inside* our own
 * subtree and SDK components would silently read host tokens. `:is()` takes the
 * specificity of its most specific branch (`.kaiten *` → one class), which buys
 * the SDK exactly one class of headroom over an equally-specific host rule —
 * enough to own its subtree, not enough to fight a deliberate host override.
 */
const SCOPE = ":is(.kaiten,.kaiten *)";

/**
 * Narrows a rule further, to the markup the SDK itself rendered.
 *
 * `SCOPE` alone means "inside the boundary" — and a non-headless
 * `<KaitenProvider>` wraps the HOST's children in that boundary. That is fine
 * for the utilities, which are keyed on class names the host does not have. It
 * is not fine for Tailwind's preflight, which is keyed on TAG names: `h1`-`h6`,
 * `a`, `ul`/`ol`, `img`, `button`, `table`, and the universal margin/padding/
 * border reset. Those rules reset the host's own markup, and since this sheet is
 * deliberately unlayered they beat any host CSS that lives in a `@layer`.
 *
 * `.ktn-own` sits on every element the SDK renders (its `.ktn-own *` branch
 * covers their internals); `.ktn-host` marks the one place the SDK mounts markup
 * it did not write — the children of `<Paywall>` — and takes it back out.
 *
 * `:where()` twice, deliberately: it contributes NO specificity, so a rule
 * carrying this suffix weighs exactly what it weighed before. That is what keeps
 * the arbitration documented in the README true, and what keeps the hand-written
 * `.kaiten *` border rule below the `border-ktn-*` utilities rather than above
 * them — an `:is()` version would weigh (0,2,0) and invert both.
 */
const OWNERSHIP = ":where(.ktn-own,.ktn-own *):not(:where(.ktn-host,.ktn-host *))";

/** Preflight and other tag-keyed base rules: the SDK's own markup only. */
const RESET_SCOPE = SCOPE + OWNERSHIP;

/** Layers Tailwind generates. Anything else in the file is hand-authored. */
const GENERATED_LAYERS = new Set(["theme", "base", "components", "utilities"]);

/**
 * Tailwind's fallback initials for its registered `--tw-*` properties, for engines
 * without `@property`. Kept in its layer on purpose: it must rank below everything
 * that reads those variables, and a layer is the cheapest way to say so. It is also
 * the one block the scope transform leaves at document scope — see `assertScoped`.
 */
const PROPERTIES_LAYER = "properties";

/**
 * Selectors carrying Tailwind's own theme variables. They must land on the SDK
 * root itself (custom properties inherit from there); scoping them as
 * descendants would leave `--spacing`, `--text-sm` &c. undefined for every
 * utility that reads them.
 */
const THEME_ROOT_SELECTORS = new Set([":root", ":host"]);

/**
 * Splits a selector list on top-level commas, ignoring commas nested in
 * `()`/`[]`, inside strings, or escaped — `.w-\[calc\(1px\,2px\)\]` is one
 * selector, and `:is(a,b)` is not two.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let start = 0;
  forEachTopLevelPosition(selector, (index, char) => {
    if (char === ",") {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
  });
  parts.push(selector.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/**
 * Walks `selector`, calling `visit` for every character that sits at nesting
 * depth zero and is not escaped or inside a string.
 */
function forEachTopLevelPosition(
  selector: string,
  visit: (index: number, char: string) => void,
): void {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];

    if (char === "\\") {
      index += 1;
      continue;
    }

    if (quote) {
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === ")" || char === "]") {
      depth -= 1;
      continue;
    }

    if (depth === 0) {
      visit(index, char);
    }
  }
}

/**
 * Index at which the selector's subject compound begins — i.e. just past the
 * last top-level combinator. `.a > .b .c` → the offset of `.c`.
 */
function subjectCompoundStart(selector: string): number {
  let start = 0;
  forEachTopLevelPosition(selector, (index, char) => {
    if (char === " " || char === ">" || char === "+" || char === "~") {
      start = index + 1;
    }
  });
  return start;
}

/**
 * Offset of the first pseudo-element in the subject compound, or -1.
 *
 * A pseudo-element must stay last in its compound: `.a::before:is(…)` is
 * invalid, `.a:is(…)::before` is not. Only `::` is treated as a pseudo-element;
 * the legacy one-colon spellings (`:before`, `:after`, `:first-line`,
 * `:first-letter`) are the only ambiguous cases and Tailwind never emits them.
 */
function pseudoElementStart(selector: string, from: number): number {
  let found = -1;
  forEachTopLevelPosition(selector, (index, char) => {
    if (found !== -1 || index < from) return;
    if (char === ":" && selector[index + 1] === ":") {
      found = index;
    }
  });
  return found;
}

/**
 * Inserts the scope into a single complex selector, after its subject compound
 * and before any pseudo-element.
 *
 * The scope is appended rather than prepended because a type selector has to
 * come first in its compound — `html:is(…)` is valid, `:is(…)html` is not.
 * Appending also gives the semantics we want for the root: `.relative:is(…)`
 * matches the `.kaiten` element itself, where a descendant scope would not.
 */
export function scopeSelector(selector: string, scope: string = SCOPE): string {
  // Hand-authored rules already say `.kaiten`; scoping them again would both
  // double the specificity and, for `.dark .kaiten`, change what they match.
  if (selector.includes(".kaiten")) {
    return selector;
  }

  const compoundStart = subjectCompoundStart(selector);
  const pseudoStart = pseudoElementStart(selector, compoundStart);
  const insertAt = pseudoStart === -1 ? selector.length : pseudoStart;

  return selector.slice(0, insertAt) + scope + selector.slice(insertAt);
}

function scopeSelectorList(selector: string, scope: string): string {
  return splitSelectorList(selector)
    .map((part) => scopeSelector(part, scope))
    .join(", ");
}

function isRule(node: ChildNode): node is Rule {
  return node.type === "rule";
}

function scopeContainer(container: Container, layer: string): void {
  // Tailwind emits the preflight, and only the preflight, into `base`. The
  // hand-authored `@layer base` block in src/styles/kaiten.css already names
  // `.kaiten`, so scopeSelector short-circuits on it and it is unaffected.
  const scope = layer === "base" ? RESET_SCOPE : SCOPE;

  for (const node of container.nodes ?? []) {
    if (isRule(node)) {
      const selectors = splitSelectorList(node.selector);
      const isThemeRoot =
        layer === "theme" && selectors.every((part) => THEME_ROOT_SELECTORS.has(part));

      // `:root, :host` carries Tailwind's theme variables. Retarget it at the SDK
      // root instead of scoping it, so the variables exist exactly where the
      // scoped utilities need them and nowhere else on the host page.
      node.selector = isThemeRoot ? ".kaiten" : scopeSelectorList(node.selector, scope);
      continue;
    }

    // @media / @supports / @container wrap rules that still need scoping.
    if (node.type === "atrule" && node.nodes) {
      scopeContainer(node, layer);
    }
  }
}

function layerNames(atRule: AtRule): string[] {
  return atRule.params
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** Strips one level of indentation from a node hoisted out of its `@layer`. */
function dedent(node: ChildNode): void {
  const raws = node.raws as Record<string, unknown>;
  for (const key of ["before", "after"]) {
    const raw = raws[key];
    if (typeof raw === "string") raws[key] = raw.replace(/\n {2}/g, "\n");
  }
  if ("nodes" in node) {
    for (const child of node.nodes ?? []) dedent(child);
  }
}

/**
 * Dissolves the generated layers, hoisting their rules to document scope in place.
 *
 * A layered declaration loses to every unlayered one no matter how specific it is, so
 * as long as the SDK shipped inside `@layer utilities` its `.bg-primary:is(.kaiten,
 * .kaiten *)` was unreachable in any host that emits plain CSS — Tailwind v3, hand-
 * written stylesheets, most CSS-in-JS. The `:is()` headroom was never consulted and
 * `appearance.variables` was inert there. Unlayered, the same rule competes on
 * specificity instead: two classes against the host's one, and the override lands.
 *
 * This is only safe because every rule here is already confined to `.kaiten` — nothing
 * gains reach over the host page, it just stops losing inside its own subtree. The two
 * orderings the layers used to buy are preserved by what replaces them:
 *
 * - preflight below utilities, by source order (Tailwind emits `base` first) plus the
 *   scope's extra class — every preflight selector lands at or under two class-level
 *   components, and utilities carry two of their own.
 * - the hand-authored `@layer base` block, which Tailwind emits *after* utilities and
 *   which therefore can no longer lean on source order, stays under them on specificity
 *   (`:where()` in `src/styles/kaiten.css` is what keeps it there).
 *
 * `@layer properties` is left alone: it has to rank below the rules that read its
 * variables, which is exactly what staying in a layer now guarantees.
 *
 * Hosts that want the opposite trade — their own CSS overriding the SDK wholesale —
 * still get it from `@import "@kaitencloud/react-ui/styles.css" layer(kaiten)`, which now
 * yields one flat layer rather than four nested ones.
 */
function unwrapGeneratedLayers(root: Container): void {
  const blocks: AtRule[] = [];
  const statements: AtRule[] = [];

  root.walkAtRules("layer", (atRule) => {
    if (!atRule.nodes) {
      // `@layer a, b, c;` — an ordering statement with no body.
      statements.push(atRule);
      return;
    }

    const names = layerNames(atRule);
    if (names.length === 1 && GENERATED_LAYERS.has(names[0]!)) blocks.push(atRule);
  });

  for (const atRule of blocks) {
    const hoisted = atRule.nodes as ChildNode[];
    for (const node of hoisted) dedent(node);
    atRule.replaceWith(hoisted);
  }

  // Drop the dissolved names from the ordering statement. Left in, it would still
  // impose an order on `theme`/`base`/`utilities` in the *host's* document — layer
  // order is fixed by first mention, so the SDK would be silently ranking layers it
  // no longer puts anything in.
  for (const atRule of statements) {
    const kept = layerNames(atRule).filter((name) => !GENERATED_LAYERS.has(name));
    if (kept.length === 0) atRule.remove();
    else atRule.params = kept.join(", ");
  }
}

/**
 * Confines every Tailwind-generated rule to the `.kaiten` subtree.
 *
 * Without this the package ships unprefixed, unscoped utilities — `.bg-primary`
 * bound to `var(--ktn-primary)`, a variable that only exists under `.kaiten` —
 * which collide by name with the host's own Tailwind build. Whichever
 * stylesheet loads last wins, so importing the SDK could blank the host's
 * utilities, and importing it first meant SDK components silently read host
 * tokens and ignored `appearance.variables`. No import order was correct.
 *
 * Hand-authored rules (already written under `.kaiten`) and global-by-necessity
 * at-rules (`@property`) pass through untouched.
 *
 * Scoping then lets the generated layers be dissolved, which is what makes the scope
 * worth anything against an unlayered host — see `unwrapGeneratedLayers`.
 */
export function scopeKaitenCss(css: string): string {
  const root = postcss.parse(css);

  root.walkAtRules("layer", (atRule) => {
    // `@layer a, b, c;` is an ordering statement with no body.
    if (!atRule.nodes) return;

    const layer = atRule.params.trim();
    if (!GENERATED_LAYERS.has(layer)) return;

    scopeContainer(atRule, layer);
  });

  unwrapGeneratedLayers(root);

  return root.toString();
}

function isAtRule(node: { type: string }): node is AtRule {
  return node.type === "atrule";
}

/** True when `node` sits inside an at-rule the scope check is allowed to skip. */
function isExempt(node: ChildNode): boolean {
  let parent: Container | PostcssDocument | undefined = node.parent;

  while (parent) {
    if (isAtRule(parent)) {
      // Keyframe steps (`from`, `50%`) are selectors only in name — they address the
      // animation, not the document, and carry no reach into the host page.
      if (parent.name.endsWith("keyframes")) return true;
      if (parent.name === "layer" && layerNames(parent).includes(PROPERTIES_LAYER)) return true;
    }
    parent = parent.parent;
  }

  return false;
}

/**
 * Fails the build if scoping produced CSS that no longer parses, or left a rule
 * unscoped. The transform does selector surgery on machine-generated input; a silent
 * miss here ships the very leak it exists to prevent.
 *
 * Checked over the whole document rather than per generated layer, because after
 * `unwrapGeneratedLayers` there are no generated layers left to walk — the old form
 * would have passed by finding nothing. Everything outside the exemptions is now
 * required to name `.kaiten`, which also catches a hand-authored rule that forgot to.
 */
export function assertScoped(css: string): void {
  const root = postcss.parse(css);
  const leaked: string[] = [];

  root.walkRules((rule) => {
    if (rule.selector.includes(".kaiten")) return;
    if (isExempt(rule)) return;
    leaked.push(rule.selector);
  });

  if (leaked.length > 0) {
    throw new Error(
      `scope-kaiten-css: ${leaked.length} rule(s) escaped the .kaiten scope:\n` +
        leaked
          .slice(0, 10)
          .map((selector) => `  ${selector}`)
          .join("\n"),
    );
  }
}

/**
 * Fails the build if a generated layer survived the transform.
 *
 * Without this the regression is invisible: the stylesheet still parses, still scopes,
 * still renders correctly in Storybook and in any Tailwind v4 host — and is inert in
 * exactly the hosts it was unlayered for.
 */
export function assertUnlayered(css: string): void {
  const survivors = new Set<string>();

  postcss.parse(css).walkAtRules("layer", (atRule) => {
    for (const name of layerNames(atRule)) {
      if (GENERATED_LAYERS.has(name)) survivors.add(name);
    }
  });

  if (survivors.size > 0) {
    throw new Error(
      `scope-kaiten-css: generated layer(s) survived unwrapping: ${[...survivors].join(", ")}. ` +
        `Anything left in a layer loses to every unlayered host rule, which is the ` +
        `precedence bug the unwrapping exists to fix.`,
    );
  }
}
