import type { VariableKey } from "./tokens.ts";

/**
 * shadcn's token names, mapped onto `appearance.variables`.
 *
 * The names are shadcn's, not Tailwind's defaults, because that is what a host actually
 * has in `globals.css` — and the overlap is near-total by design: both vocabularies
 * descend from the same fill/foreground pairing.
 */
const SHADCN_TO_KAITEN: Record<string, VariableKey> = {
  background: "colorBackground",
  foreground: "colorForeground",
  card: "colorCard",
  "card-foreground": "colorCardForeground",
  popover: "colorPopover",
  "popover-foreground": "colorPopoverForeground",
  primary: "colorPrimary",
  "primary-foreground": "colorPrimaryForeground",
  secondary: "colorSecondary",
  "secondary-foreground": "colorSecondaryForeground",
  muted: "colorMuted",
  "muted-foreground": "colorMutedForeground",
  accent: "colorAccent",
  "accent-foreground": "colorAccentForeground",
  destructive: "colorDestructive",
  "destructive-foreground": "colorDestructiveForeground",
  border: "colorBorder",
  input: "colorInput",
  ring: "colorRing",
  radius: "borderRadius",
  "font-sans": "fontFamily",
};

/**
 * Kaiten keys shadcn has no equivalent for.
 *
 * Split by what the absence *means*, because the two want opposite advice: the hover
 * and foreground pairs get derived from their fill and are genuinely fine left alone,
 * whereas success and the tinted destructive surface have no source at all and will
 * keep the SDK's defaults — which may simply not match the imported palette. Saying
 * "21 of 30 mapped" and stopping would hide that difference.
 */
const DERIVED_WHEN_ABSENT = new Set<VariableKey>([
  "colorPrimaryHover",
  "colorSecondaryHover",
  "colorAccentHover",
  "colorDestructiveHover",
  "colorSuccessHover",
]);

const NO_SHADCN_SOURCE: VariableKey[] = [
  "colorSuccess",
  "colorSuccessForeground",
  "colorDestructiveSubtle",
  "colorDestructiveSubtleForeground",
];

export type ColorForm = "hex" | "hsl-triplet" | "hsl-function" | "passthrough";

export interface ParsedDeclaration {
  key: VariableKey;
  /** The value as it will be written into `appearance.variables`. */
  value: string;
  /** What the source looked like, so the UI can explain a passthrough. */
  form: ColorForm;
  source: string;
}

export interface ParsedBlock {
  /** `":root"` / `".dark"` — the selector this palette came from. */
  selector: string;
  variables: Partial<Record<VariableKey, string>>;
  declarations: ParsedDeclaration[];
  /** shadcn custom properties with no Kaiten counterpart (`--chart-1`, `--sidebar`…). */
  unmapped: string[];
  /** Kaiten keys the import could not fill, and why. */
  missing: Array<{ key: VariableKey; reason: "derived" | "no-source" }>;
}

export interface ShadcnImportResult {
  light?: ParsedBlock;
  dark?: ParsedBlock;
  /** Problems worth showing before anything is applied. */
  warnings: string[];
}

/** `#abc` / `#aabbcc` → `#aabbcc`. */
function normalizeHex(raw: string): string | undefined {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short)
    return `#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`.toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  return undefined;
}

function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hue = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[Math.floor(hue) % 6]!;
  return `#${[r + m, g + m, b + m]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel * 255)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const NUMBER = String.raw`[-+]?[0-9]*\.?[0-9]+`;
const HSL_TRIPLET = new RegExp(`^(${NUMBER})(?:deg)?[\\s,]+(${NUMBER})%[\\s,]+(${NUMBER})%$`);

/**
 * A shadcn colour value in any of the shapes the ecosystem actually ships.
 *
 * The bare triplet is the one that matters: shadcn's Tailwind v3 template stores
 * `222.2 47.4% 11.2%` and wraps it at use site (`hsl(var(--primary))`), so copying that
 * value straight across would set `--ktn-primary` to a string that is not a colour and
 * paint nothing. Newer templates store a complete `oklch(…)` instead, which is already
 * a colour and is passed through untouched.
 */
export function parseColorValue(raw: string): { value: string; form: ColorForm } {
  const value = raw.trim().replace(/\s+/g, " ");

  const hex = normalizeHex(value);
  if (hex) return { value: hex, form: "hex" };

  const fn = /^hsla?\(\s*([^)]+?)\s*\)$/i.exec(value);
  if (fn) {
    // Alpha is dropped rather than guessed at: `--ktn-*` takes a plain fill and the
    // SDK composes its own transparency where it wants it.
    const inner = fn[1]!.split("/")[0]!.trim();
    const triplet = HSL_TRIPLET.exec(inner);
    if (triplet) {
      return {
        value: hslToHex(Number(triplet[1]), Number(triplet[2]), Number(triplet[3])),
        form: "hsl-function",
      };
    }
    return { value, form: "passthrough" };
  }

  const bare = HSL_TRIPLET.exec(value.split("/")[0]!.trim());
  if (bare) {
    return {
      value: hslToHex(Number(bare[1]), Number(bare[2]), Number(bare[3])),
      form: "hsl-triplet",
    };
  }

  return { value, form: "passthrough" };
}

interface RawRule {
  selector: string;
  body: string;
}

/** Every rule in the sheet, including ones nested in `@layer` / `@media`. */
function eachRule(css: string): RawRule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: RawRule[] = [];
  const stack: Array<{ selector: string; start: number }> = [];
  let sliceStart = 0;

  for (let i = 0; i < withoutComments.length; i += 1) {
    const char = withoutComments[i];
    if (char === "{") {
      stack.push({ selector: withoutComments.slice(sliceStart, i).trim(), start: i + 1 });
      sliceStart = i + 1;
    } else if (char === "}") {
      const open = stack.pop();
      if (open) rules.push({ selector: open.selector, body: withoutComments.slice(open.start, i) });
      sliceStart = i + 1;
    } else if (char === ";" && stack.length === 0) {
      sliceStart = i + 1;
    }
  }
  return rules;
}

/** Custom-property declarations at this rule's own level, ignoring nested rules. */
function declarationsOf(body: string): Array<[string, string]> {
  const flat = body.replace(/\{[^{}]*\}/g, "");
  const out: Array<[string, string]> = [];
  for (const match of flat.matchAll(/--([\w-]+)\s*:\s*([^;]+)(?:;|$)/g)) {
    out.push([match[1]!, match[2]!.trim()]);
  }
  return out;
}

function buildBlock(selector: string, declarations: Array<[string, string]>): ParsedBlock {
  const parsed: ParsedDeclaration[] = [];
  const unmapped: string[] = [];
  const variables: Partial<Record<VariableKey, string>> = {};

  for (const [name, rawValue] of declarations) {
    // `--color-primary: var(--primary)` in a v4 `@theme inline` block is an alias, not
    // a palette entry; following it would import the literal text "var(--primary)".
    if (rawValue.startsWith("var(")) continue;

    const key = SHADCN_TO_KAITEN[name];
    if (!key) {
      unmapped.push(`--${name}`);
      continue;
    }

    // `radius` and `font-sans` are a length and a font stack; running them through the
    // colour parser would only ever produce a passthrough, but saying so is clearer.
    const isColor = key !== "borderRadius" && key !== "fontFamily";
    const { value, form } = isColor
      ? parseColorValue(rawValue)
      : { value: rawValue.trim(), form: "passthrough" as const };

    variables[key] = value;
    parsed.push({ key, value, form, source: `--${name}: ${rawValue}` });
  }

  const missing: ParsedBlock["missing"] = [];
  for (const key of NO_SHADCN_SOURCE) {
    if (variables[key] === undefined) missing.push({ key, reason: "no-source" });
  }
  for (const key of DERIVED_WHEN_ABSENT) {
    if (variables[key] === undefined) missing.push({ key, reason: "derived" });
  }

  return { selector, variables, declarations: parsed, unmapped, missing };
}

/**
 * Reads a pasted `globals.css` (or just its `:root` / `.dark` block).
 *
 * Both palettes are returned rather than merged, and that is a limitation being
 * surfaced rather than a convenience: `appearance.variables` is one flat set written as
 * inline custom properties on the SDK root, so it overrides the `.kaiten` and
 * `.kaiten.dark` token blocks *alike*. One `appearance` object therefore cannot say
 * "this palette in light, that one in dark" — the host has to swap `appearance` when
 * their own theme toggles. Importing both silently would produce a config that looks
 * complete and is wrong in one of the two modes.
 */
export function parseShadcnCss(css: string): ShadcnImportResult {
  const warnings: string[] = [];
  const rules = eachRule(css);

  const collect = (match: (selector: string) => boolean) => {
    const declarations = rules
      .filter((rule) => match(rule.selector))
      .flatMap((rule) => declarationsOf(rule.body));
    return declarations.length > 0 ? declarations : undefined;
  };

  const lightDeclarations = collect(
    (selector) => /(^|[\s,])(:root|html)\b/.test(selector) && !/\.dark\b/.test(selector),
  );
  const darkDeclarations = collect((selector) => /\.dark\b/.test(selector));

  if (!lightDeclarations && !darkDeclarations) {
    // A bare list of declarations with no selector around it is a plausible paste.
    const loose = declarationsOf(css.replace(/\/\*[\s\S]*?\*\//g, ""));
    if (loose.length === 0) {
      warnings.push(
        "No custom properties found. Paste a :root { … } block or a whole globals.css.",
      );
      return { warnings };
    }
    warnings.push("No :root or .dark selector found — treating the paste as a single palette.");
    return { light: buildBlock(":root", loose), warnings };
  }

  const result: ShadcnImportResult = { warnings };
  if (lightDeclarations) result.light = buildBlock(":root", lightDeclarations);
  if (darkDeclarations) result.dark = buildBlock(".dark", darkDeclarations);

  if (result.light && result.dark) {
    warnings.push(
      "Both :root and .dark were found. appearance.variables is a single flat set, so pick one — " +
        "to support both, swap the appearance object when your own theme toggles.",
    );
  }

  const passthrough = [...(result.light?.declarations ?? []), ...(result.dark?.declarations ?? [])]
    .filter(
      (declaration) =>
        declaration.form === "passthrough" &&
        declaration.key !== "borderRadius" &&
        declaration.key !== "fontFamily",
    )
    .map((declaration) => declaration.key);
  if (passthrough.length > 0) {
    warnings.push(
      `Copied verbatim (not a hex or hsl value, so the swatch and the derived foreground/hover cannot be computed): ${[...new Set(passthrough)].join(", ")}.`,
    );
  }

  return result;
}
