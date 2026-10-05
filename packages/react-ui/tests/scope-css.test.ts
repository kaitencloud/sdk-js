import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vite-plus/test";

import {
  assertScoped,
  assertUnlayered,
  scopeKaitenCss,
  scopeSelector,
  splitSelectorList,
} from "../scripts/scope-kaiten-css.ts";

const SCOPE = ":is(.kaiten,.kaiten *)";

describe("splitSelectorList", () => {
  it("splits on top-level commas only", () => {
    expect(splitSelectorList(".a, .b")).toEqual([".a", ".b"]);
    expect(splitSelectorList(".a:is(.b,.c)")).toEqual([".a:is(.b,.c)"]);
    expect(splitSelectorList('.a[data-x="y, z"]')).toEqual(['.a[data-x="y, z"]']);
  });

  it("does not split on an escaped comma", () => {
    // Tailwind escapes arbitrary values, e.g. `w-[calc(1px,2px)]`.
    expect(splitSelectorList(String.raw`.w-\[calc\(1px\,2px\)\]`)).toHaveLength(1);
  });
});

describe("scopeSelector", () => {
  it("appends the scope so it also matches the root element", () => {
    // Appended, not prepended: `.relative:is(.kaiten,…)` matches the `.kaiten`
    // element itself, where a descendant scope would miss it.
    expect(scopeSelector(".relative")).toBe(`.relative${SCOPE}`);
  });

  it("keeps a type selector first in its compound", () => {
    // `:is(…)html` is invalid CSS.
    expect(scopeSelector("html")).toBe(`html${SCOPE}`);
    expect(scopeSelector("*")).toBe(`*${SCOPE}`);
  });

  it("scopes the subject compound, not the ancestors", () => {
    expect(scopeSelector(".a .b")).toBe(`.a .b${SCOPE}`);
    expect(scopeSelector(".a > .b")).toBe(`.a > .b${SCOPE}`);
    expect(scopeSelector(".a + .b")).toBe(`.a + .b${SCOPE}`);
  });

  it("keeps a pseudo-element last", () => {
    // `.foo::before:is(…)` is invalid — the pseudo-element must close the compound.
    expect(scopeSelector(".foo::before")).toBe(`.foo${SCOPE}::before`);
    expect(scopeSelector(".a .b::file-selector-button")).toBe(
      `.a .b${SCOPE}::file-selector-button`,
    );
  });

  it("survives Tailwind's escaped class names", () => {
    expect(scopeSelector(String.raw`.bg-secondary\/50`)).toBe(
      String.raw`.bg-secondary\/50` + SCOPE,
    );
    expect(scopeSelector(String.raw`.\[\.border-t\]\:pt-6:is(.border-t)`)).toBe(
      String.raw`.\[\.border-t\]\:pt-6:is(.border-t)` + SCOPE,
    );
  });

  it("leaves hand-authored .kaiten rules alone", () => {
    // Re-scoping `.dark .kaiten` would change what it matches.
    expect(scopeSelector(".dark .kaiten")).toBe(".dark .kaiten");
    expect(scopeSelector(".kaiten button:not(:disabled)")).toBe(".kaiten button:not(:disabled)");
  });
});

describe("scopeKaitenCss", () => {
  it("retargets Tailwind's theme variables at the SDK root", () => {
    // Scoping `:root` as a descendant would leave `--spacing` undefined for
    // every utility that reads it.
    const out = scopeKaitenCss("@layer theme { :root, :host { --spacing: 0.25rem; } }");
    expect(out).toContain(".kaiten {");
    expect(out).not.toContain(":root");
  });

  it("scopes utilities and preflight", () => {
    const out = scopeKaitenCss(
      "@layer base { *, ::before { margin: 0; } }@layer utilities { .flex { display: flex; } }",
    );
    expect(out).toContain(`*${SCOPE}`);
    expect(out).toContain(`::before`);
    expect(out).toContain(`.flex${SCOPE}`);
  });

  it("scopes rules nested in at-rules", () => {
    const out = scopeKaitenCss(
      "@layer utilities { @media (min-width: 48rem) { .md\\:block { display: block; } } }",
    );
    expect(out).toContain(SCOPE);
  });

  it("leaves layers it does not own untouched", () => {
    const css = "@layer properties { @supports (color: red) { .x { color: red; } } }";
    expect(scopeKaitenCss(css)).toBe(css);
  });

  it("dissolves the generated layers", () => {
    // The whole point: a layered rule loses to every unlayered host rule however
    // specific it is, so `.bg-primary:is(.kaiten,…)` was unreachable in a Tailwind v3
    // or plain-CSS host. Unlayered it competes on specificity and wins.
    const out = scopeKaitenCss("@layer utilities { .flex { display: flex; } }");
    expect(out).not.toContain("@layer");
    expect(out).toContain(`.flex${SCOPE}`);
  });

  it("drops the dissolved names from the ordering statement", () => {
    // Left in, it would still fix the order of `theme`/`base`/`utilities` in the
    // *host's* document — layer order is settled by first mention.
    expect(scopeKaitenCss("@layer theme, base, components, utilities;")).toBe("");
  });

  it("keeps ordering statements for layers it does not own", () => {
    const out = scopeKaitenCss("@layer properties, theme, utilities;");
    expect(out).toBe("@layer properties;");
  });

  it("keeps `properties` in its layer", () => {
    // Tailwind's `--tw-*` fallbacks have to rank below everything that reads them,
    // which is precisely what staying in a layer buys once the rest is unlayered.
    const css = "@layer properties { @supports (color: red) { .x { color: red; } } }";
    expect(scopeKaitenCss(css)).toBe(css);
  });
});

describe("assertUnlayered", () => {
  it("throws when a generated layer survived", () => {
    expect(() => assertUnlayered("@layer utilities { .flex:is(.kaiten,.kaiten *) {} }")).toThrow(
      /survived unwrapping/,
    );
  });

  it("catches a surviving ordering statement too", () => {
    expect(() => assertUnlayered("@layer theme, base;")).toThrow(/theme, base/);
  });

  it("passes on unwrapped output, `properties` included", () => {
    expect(() =>
      assertUnlayered(scopeKaitenCss("@layer properties;@layer utilities { .flex {} }")),
    ).not.toThrow();
  });
});

describe("assertScoped", () => {
  it("throws when a generated rule escaped the scope", () => {
    expect(() => assertScoped("@layer utilities { .flex { display: flex; } }")).toThrow(
      /escaped the \.kaiten scope/,
    );
  });

  it("passes on scoped output", () => {
    expect(() =>
      assertScoped(scopeKaitenCss("@layer utilities { .flex { display: flex; } }")),
    ).not.toThrow();
  });
});

describe("the shipped stylesheet", () => {
  it("leaks no generated rule into the host cascade", async () => {
    // The regression this whole transform exists for: `.bg-primary` bound to
    // `var(--ktn-primary)` collides by name with the host's own Tailwind build,
    // and `--ktn-primary` only exists under `.kaiten` — so an unscoped copy
    // winning the cascade blanks the host's `.bg-primary` everywhere.
    const cssPath = path.resolve(import.meta.dirname, "../dist/kaiten.css");
    const css = await readFile(cssPath, "utf8");

    expect(() => assertScoped(css)).not.toThrow();
    // And it must still be valid CSS after the surgery.
    expect(() => postcss.parse(css)).not.toThrow();
  });

  it("ships nothing in a layer but Tailwind's `--tw-*` fallbacks", async () => {
    // A layered SDK is inert in exactly the hosts it is sold into — the failure is
    // invisible in Storybook and in any Tailwind v4 host, so it needs pinning here.
    // `Integration/Appearance precedence` asserts the behaviour this shape produces.
    const css = await readFile(path.resolve(import.meta.dirname, "../dist/kaiten.css"), "utf8");

    expect(() => assertUnlayered(css)).not.toThrow();
    expect([...css.matchAll(/@layer\s+([^{;]+)/g)].map((m) => m[1].trim())).toEqual([
      "properties",
      "properties",
    ]);
  });

  it("keeps the hand-authored base rules under the utilities", async () => {
    // Unlayered, the block Tailwind emits *after* the utilities can only stay below
    // them on specificity. `:where()` is what holds `cursor-*` on a Button working.
    const css = await readFile(path.resolve(import.meta.dirname, "../dist/kaiten.css"), "utf8");

    expect(css).toContain(
      ':where(.kaiten) [role="button"]:where(.ktn-own, .ktn-own *):where(:not(:disabled))',
    );
    // Every part is `:where()`, so the rule still weighs one class — an `:is()`
    // anywhere in it would lift it above the `cursor-*` utilities it must sit under.
    expect(css).not.toMatch(/\.kaiten \[role="button"\]:not\(/);
    expect(css).not.toMatch(/\[role="button"\]:is\(\.ktn-own/);
  });
});

describe("the boundary does not paint the host", () => {
  // `.kaiten` wraps the HOST's children — the provider renders
  // `<div className="kaiten">{children}</div>` — so anything the boundary
  // *declares* lands on the host's page, not just on SDK markup.
  //
  // It used to declare `background-color`, and the first consumer undid it by
  // hand with `.kaiten { background-color: transparent }` and a comment
  // describing the symptom ("reads as an extra column background over the
  // page"). A workaround shipped by a consumer is the strongest evidence a
  // default is wrong.
  async function boundaryDeclarations(): Promise<Map<string, string>> {
    const css = await readFile(path.join(import.meta.dirname, "../dist/kaiten.css"), "utf8");
    const declarations = new Map<string, string>();

    postcss.parse(css).walkRules((rule) => {
      // Exactly the boundary, not `.kaiten <something>`.
      if (splitSelectorList(rule.selector).some((part) => part.trim() !== ".kaiten")) return;
      rule.walkDecls((decl) => {
        // Custom properties are the boundary's actual job: the tokens have to be
        // declared somewhere for the subtree to inherit them.
        if (decl.prop.startsWith("--")) return;
        declarations.set(decl.prop, decl.value);
      });
    });

    return declarations;
  }

  it("declares no background on the boundary itself", async () => {
    const declarations = await boundaryDeclarations();
    for (const prop of declarations.keys()) {
      expect(prop).not.toMatch(/^background/);
    }
  });

  it("declares nothing on the boundary beyond the token carrier's own needs", async () => {
    const declarations = await boundaryDeclarations();

    // `color` is inherited rather than declared per element, so it carries no
    // specificity and any host rule beats it — and moving it onto SDK elements
    // would override the `text-card-foreground` a Card sets on its subtree.
    // `position` is the portal host's containing block.
    expect([...declarations.keys()].sort()).toEqual(["color", "position"]);
  });
});
