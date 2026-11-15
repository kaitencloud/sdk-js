// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vite-plus/test";

import {
  ALL_KEYS,
  CSS_VAR_OF,
  DERIVED_FROM,
  derivedValueFor,
} from "../.storybook/theme-playground/tokens.ts";
import {
  changedKeys,
  isDirty,
  toAppearanceSource,
  type AppearanceDraft,
  bucketOf,
  effectiveEntry,
  derivedPairs,
} from "../.storybook/theme-playground/serialize.ts";
import { parseColorValue, parseShadcnCss } from "../.storybook/theme-playground/shadcn.ts";

function draft(partial: Partial<AppearanceDraft>): AppearanceDraft {
  return { baseTheme: "light", variables: {}, modes: { light: {}, dark: {} }, ...partial };
}

describe("token catalogue", () => {
  it("covers every key the appearance type declares", () => {
    // The catalogue drives the whole editor, so a key added to `KaitenAppearance`
    // and not to the groups would be silently un-themable. `CSS_VAR_OF` is built by
    // probing `resolveVariables`, which throws for a key it cannot bind — so the
    // real assertion is that this module imported at all. This pins the count.
    expect(ALL_KEYS).toHaveLength(30);
    expect(new Set(ALL_KEYS).size).toBe(ALL_KEYS.length);
  });

  it("learns the css custom property for each key from apply.ts", () => {
    expect(CSS_VAR_OF.colorPrimary).toBe("--ktn-primary");
    expect(CSS_VAR_OF.borderRadius).toBe("--ktn-radius");
    expect(CSS_VAR_OF.fontFamily).toBe("--ktn-font-sans");
  });

  it("discovers which keys apply.ts fills in from a bare fill", () => {
    expect(DERIVED_FROM.colorPrimaryForeground).toBe("colorPrimary");
    expect(DERIVED_FROM.colorPrimaryHover).toBe("colorPrimary");
    // The background rebuilds its neutral family now — the probe discovered
    // the new pairing on its own, which is exactly why it exists.
    expect(DERIVED_FROM.colorBorder).toBe("colorBackground");
    expect(DERIVED_FROM.colorCard).toBe("colorBackground");
    // A fill with no pairing still derives nothing.
    expect(DERIVED_FROM.colorRing).toBeUndefined();
  });

  it("reports the value a bare fill would derive, and nothing once it is set", () => {
    expect(derivedValueFor({ colorPrimary: "#0f766e" }, "colorPrimaryForeground")).toBe("#ffffff");
    expect(
      derivedValueFor(
        { colorPrimary: "#0f766e", colorPrimaryForeground: "#eeeeee" },
        "colorPrimaryForeground",
      ),
    ).toBeUndefined();
    expect(derivedValueFor({}, "colorPrimaryForeground")).toBeUndefined();
  });
});

describe("toAppearanceSource", () => {
  it("emits only what was set, never the untouched defaults", () => {
    const source = toAppearanceSource(
      draft({ variables: { colorPrimary: "#0f766e", borderRadius: "0.25rem" } }),
    );

    expect(source).toContain('colorPrimary: "#0f766e"');
    expect(source).toContain('borderRadius: "0.25rem"');
    // The regression this guards: a 30-key dump of values the SDK already ships.
    expect(changedKeys({ colorPrimary: "#0f766e" })).toEqual(["colorPrimary"]);
    expect(source).not.toContain("colorMuted");
    expect(source).not.toContain("colorSuccess");
    // Derived pairs must stay out, or the config freezes today's derivation.
    expect(source).not.toContain("colorPrimaryForeground:");
    expect(source).not.toContain("colorPrimaryHover:");
  });

  it("notes the pairs the SDK will derive", () => {
    const source = toAppearanceSource(draft({ variables: { colorPrimary: "#0f766e" } }));
    expect(source).toContain("colorPrimaryForeground is derived from colorPrimary");
  });

  it("omits baseTheme when it is the default and emits it otherwise", () => {
    expect(toAppearanceSource(draft({ variables: { colorPrimary: "#000000" } }))).not.toContain(
      "baseTheme",
    );
    expect(
      toAppearanceSource(draft({ baseTheme: "dark", variables: { colorPrimary: "#000000" } })),
    ).toContain('baseTheme: "dark"');
  });

  it("says so plainly when nothing has been overridden", () => {
    expect(isDirty(draft({}))).toBe(false);
    expect(toAppearanceSource(draft({}))).toContain("Nothing overridden yet");
    expect(toAppearanceSource(draft({}))).toContain("KaitenAppearance = {}");
  });

  it("orders keys by catalogue, not by when they were touched", () => {
    const source = toAppearanceSource(
      draft({ variables: { borderRadius: "1rem", colorPrimary: "#111111" } }),
    );
    expect(source.indexOf("colorPrimary")).toBeLessThan(source.indexOf("borderRadius"));
  });

  it("escapes values rather than pasting them raw", () => {
    const source = toAppearanceSource(draft({ variables: { fontFamily: 'My "Font", serif' } }));
    expect(source).toContain(String.raw`fontFamily: "My \"Font\", serif"`);
  });
});

describe("parseColorValue", () => {
  it("reads shadcn's bare hsl triplet", () => {
    // The important case: copied verbatim this is not a colour at all, because shadcn
    // wraps it at the use site with `hsl(var(--primary))`.
    expect(parseColorValue("222.2 47.4% 11.2%")).toEqual({ value: "#0f172a", form: "hsl-triplet" });
    expect(parseColorValue("0 0% 100%").value).toBe("#ffffff");
  });

  it("reads hsl() in space and comma form, dropping alpha", () => {
    expect(parseColorValue("hsl(222.2 47.4% 11.2%)").value).toBe("#0f172a");
    expect(parseColorValue("hsl(222.2, 47.4%, 11.2%)").value).toBe("#0f172a");
    expect(parseColorValue("hsl(222.2 47.4% 11.2% / 0.5)").value).toBe("#0f172a");
  });

  it("normalises hex, including the short form", () => {
    expect(parseColorValue("#FFF")).toEqual({ value: "#ffffff", form: "hex" });
    expect(parseColorValue("#0F766E")).toEqual({ value: "#0f766e", form: "hex" });
  });

  it("passes a colour it cannot convert through untouched", () => {
    // `oklch(…)` is already a valid CSS colour, so forwarding it beats dropping it —
    // only the swatch and the derived pair are unavailable.
    expect(parseColorValue("oklch(0.65 0.2 250)")).toEqual({
      value: "oklch(0.65 0.2 250)",
      form: "passthrough",
    });
  });
});

const SHADCN_V3 = `
  @layer base {
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --primary: 222.2 47.4% 11.2%;
      --primary-foreground: 210 40% 98%;
      --destructive: 0 84.2% 60.2%;
      --border: 214.3 31.8% 91.4%;
      --radius: 0.5rem;
      --chart-1: 12 76% 61%;
    }
    .dark {
      --background: 222.2 84% 4.9%;
      --primary: 210 40% 98%;
    }
  }
`;

describe("parseShadcnCss", () => {
  it("maps a v3 globals.css onto appearance variables", () => {
    const { light } = parseShadcnCss(SHADCN_V3);

    expect(light?.variables.colorBackground).toBe("#ffffff");
    expect(light?.variables.colorPrimary).toBe("#0f172a");
    expect(light?.variables.colorPrimaryForeground).toBe("#f8fafc");
    expect(light?.variables.borderRadius).toBe("0.5rem");
  });

  it("keeps the two palettes apart and says why", () => {
    const result = parseShadcnCss(SHADCN_V3);

    expect(result.dark?.variables.colorBackground).toBe("#020817");
    // One flat variable set cannot serve both modes; merging them silently would
    // produce a config that is wrong in one of the two.
    expect(result.warnings.join(" ")).toMatch(/single flat set/);
  });

  it("reports shadcn tokens it has nowhere to put", () => {
    expect(parseShadcnCss(SHADCN_V3).light?.unmapped).toContain("--chart-1");
  });

  it("distinguishes a key that gets derived from one with no source at all", () => {
    const missing = parseShadcnCss(SHADCN_V3).light!.missing;
    const reasonOf = (key: string) => missing.find((entry) => entry.key === key)?.reason;

    expect(reasonOf("colorPrimaryHover")).toBe("derived");
    // shadcn has no success palette, so this keeps the SDK default — which may simply
    // not match the imported theme. Saying "mapped 7 tokens" would hide that.
    expect(reasonOf("colorSuccess")).toBe("no-source");
  });

  it("ignores @theme inline aliases that point at other variables", () => {
    const result = parseShadcnCss(`
      :root { --primary: #0f766e; }
      @theme inline { --color-primary: var(--primary); }
    `);
    expect(result.light?.variables.colorPrimary).toBe("#0f766e");
    expect(result.light?.unmapped ?? []).not.toContain("--color-primary");
  });

  it("accepts a bare block with no selector", () => {
    const result = parseShadcnCss("--primary: #0f766e; --radius: 1rem;");
    expect(result.light?.variables.colorPrimary).toBe("#0f766e");
    expect(result.warnings.join(" ")).toMatch(/single palette/);
  });

  it("says nothing was found rather than returning an empty theme", () => {
    const result = parseShadcnCss("body { color: red }");
    expect(result.light).toBeUndefined();
    expect(result.warnings.join(" ")).toMatch(/No custom properties found/);
  });
});

// Editing per mode is what the split in `KaitenAppearance` is FOR: `variables`
// holds what means the same thing in either mode, `modes` what does not. The
// editor writes into one bucket at a time, so these guard the routing.
describe("per-mode editing", () => {
  it("emits variables and modes as separate blocks", () => {
    const source = toAppearanceSource(
      draft({
        variables: { colorPrimary: "#7c3aed" },
        modes: { light: { colorBackground: "#f8fafc" }, dark: { colorBackground: "#0f172a" } },
      }),
    );

    expect(source).toContain("variables: {");
    expect(source).toContain('colorPrimary: "#7c3aed"');
    expect(source).toContain("modes: {");
    expect(source).toContain("light: {");
    expect(source).toContain('colorBackground: "#f8fafc"');
    expect(source).toContain("dark: {");
    expect(source).toContain('colorBackground: "#0f172a"');
  });

  it("omits a mode nobody edited, rather than emitting an empty object", () => {
    const source = toAppearanceSource(draft({ modes: { light: {}, dark: { colorCard: "#111" } } }));

    expect(source).toContain("dark: {");
    expect(source).not.toContain("light: {");
  });

  it("counts a per-mode value as a change, or Reset would look disabled", () => {
    expect(isDirty(draft({}))).toBe(false);
    expect(isDirty(draft({ modes: { light: {}, dark: { colorCard: "#111" } } }))).toBe(true);
  });

  it("routes a scope to its bucket", () => {
    const current = draft({
      variables: { colorPrimary: "#7c3aed" },
      modes: { light: {}, dark: { colorBackground: "#0f172a" } },
    });

    expect(bucketOf(current, "both")).toEqual({ colorPrimary: "#7c3aed" });
    expect(bucketOf(current, "dark")).toEqual({ colorBackground: "#0f172a" });
    expect(bucketOf(current, "light")).toEqual({});
  });

  it("reports where a key's value comes from in a given mode", () => {
    const current = draft({
      variables: { colorPrimary: "#7c3aed" },
      modes: { light: {}, dark: { colorPrimary: "#a78bfa" } },
    });

    // The per-mode value wins; the editor shows the `both` badge when it does not,
    // so a field is never blank over a coloured swatch.
    expect(effectiveEntry(current, "colorPrimary", "dark")).toEqual({
      value: "#a78bfa",
      scope: "dark",
    });
    expect(effectiveEntry(current, "colorPrimary", "light")).toEqual({
      value: "#7c3aed",
      scope: "both",
    });
    expect(effectiveEntry(current, "colorCard", "light")).toEqual({
      value: undefined,
      scope: "both",
    });
  });

  it("sees a derived pair across buckets", () => {
    // The fill sits in `variables`, its pair is unset everywhere — the flattened
    // view is the only one that can tell.
    const pairs = derivedPairs(
      draft({ variables: { colorPrimary: "#7c3aed" }, modes: { light: {}, dark: {} } }),
    );

    expect(pairs.map((entry) => entry.pair)).toContain("colorPrimaryForeground");
  });
});
