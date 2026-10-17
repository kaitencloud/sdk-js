// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { SWRConfig } from "swr";
import type { Cache } from "swr";

import { KaitenProvider } from "@kaitencloud/react";
import { KaitenStyleRoot } from "../../src/style-root/kaiten-style-root.tsx";
import type { KaitenAppearance } from "../../src/appearance/types.ts";
import { themes } from "../../src/appearance/themes.ts";
import { CustomerPortal } from "../../src/components/customer-portal/customer-portal.tsx";
import { Paywall } from "../../src/components/paywall/paywall.tsx";
import { PlanBadge } from "../../src/components/plan-badge/plan-badge.tsx";
import { PricingTable } from "../../src/components/pricing-table/pricing-table.tsx";
import { Badge } from "../../src/components/ui/badge.tsx";
import { Button } from "../../src/components/ui/button.tsx";
import { Card, CardContent } from "../../src/components/ui/card.tsx";
import { Input } from "../../src/components/ui/input.tsx";
import { Separator } from "../../src/components/ui/separator.tsx";
import { createStoryClient, scenarioPortalDefault, STORYBOOK_API_BASE } from "../kaiten-mock.tsx";
import { PLAYGROUND_CSS } from "./styles.ts";
import {
  ALL_KEYS,
  CSS_VAR_OF,
  DERIVED_FROM,
  VARIABLE_GROUPS,
  derivedValueFor,
  type VariableEntry,
  type VariableKey,
} from "./tokens.ts";
import {
  bucketOf,
  EMPTY_DRAFT,
  isDirty,
  toAppearanceSource,
  VARIABLE_SCOPES,
  type AppearanceDraft,
  type VariableScope,
} from "./serialize.ts";
import { parseShadcnCss, type ShadcnImportResult } from "./shadcn.ts";

const scenario = scenarioPortalDefault();

type Surface = "all" | "pricing" | "portal" | "paywall" | "badge";

const SURFACES: Array<{ value: Surface; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "pricing", label: "Pricing table" },
  { value: "portal", label: "Customer portal" },
  { value: "paywall", label: "Paywall" },
  { value: "badge", label: "Plan badge" },
];

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The SDK has no select primitive, so this is a native `<select>` wearing `Input`'s
 * classes — the one place the chrome hand-matches rather than reuses.
 */
const SELECT_CLASS =
  "border-input bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm shadow-xs " +
  "outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const LABEL_CLASS = "text-muted-foreground text-[11px] font-medium tracking-wide uppercase";

/**
 * One data scope for both preview panels, rendering no `.kaiten` of its own.
 *
 * The provider renders no element, which is what makes the side-by-side work: each
 * panel owns an independent `KaitenStyleRoot`, so the dark one can carry `.dark`
 * without the light one inheriting it. Nested roots would not do — the dark token
 * block matches `.dark .kaiten`, so a light panel inside a dark ancestor would still
 * resolve dark.
 */
function PlaygroundProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(() => createStoryClient(scenario), []);
  const cache = React.useMemo<Cache>(() => new Map(), []);
  const provider = React.useCallback(() => cache, [cache]);

  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="authenticated"
        apiUrl={STORYBOOK_API_BASE}
        accessToken="storybook-token"
        customerId={scenario.customer!.id}
        instanceId={scenario.instance.id}
        polling={{ enabled: false }}
        client={client}
      >
        {children}
      </KaitenProvider>
    </SWRConfig>
  );
}

/**
 * The soft paywall, mounted a tick after the rest of the preview.
 *
 * When its wall goes up it moves focus into the panel (so keyboard users cannot
 * tab into the masked content behind it). Storybook patches `HTMLElement.focus` to
 * dispatch its focus events through `@storybook/react`'s `act()` wrapper, so when that
 * focus lands in the same commit as the rest of the preview React is already working
 * and throws "Should not already be working" — taking the whole story down. Its own
 * tick means its own commit.
 *
 * Only Storybook's instrumentation turns this into a crash; a real host just gets the
 * focus move, and `Paywall` passes `preventScroll` so that move no longer drags the
 * page along with it. Nothing here has to put scroll back.
 */
function DeferredPaywall() {
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);

  if (!mounted) return null;

  return (
    /* A low threshold against the fixture's 42%-consumed quota, so the soft paywall
       is actually on screen rather than a state you have to imagine. */
    <Paywall entitlement="api_calls" threshold={0.3} mode="soft">
      {/*
       * Stand-in for the host's gated feature, and it has to have real size.
       *
       * The soft wall is an `absolute inset-0` overlay over whatever it wraps, so the box
       * it covers is the box you hand it — and below the card's own footprint the wall
       * collapses to a single row (`.ktn-paywall-wall` in src/styles/kaiten.css). That is
       * the right answer for a host gating a button; it is the wrong thing to theme
       * against, since it drops the meter, the description and the branding. 20rem clears
       * the card's ~253px plus the frame's padding, with room for the description to wrap
       * in a longer locale, so the playground keeps showing every part you can restyle.
       */}
      <div className="flex min-h-80 flex-col gap-3 rounded-ktn-lg border border-ktn-border p-4">
        <p className="text-sm font-medium">API usage this month</p>
        <div className="flex flex-1 items-end gap-2" aria-hidden="true">
          {[38, 62, 45, 80, 54, 71, 49, 66].map((height, index) => (
            <div
              className="flex-1 rounded-t-ktn-sm bg-ktn-primary/70"
              key={index}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
    </Paywall>
  );
}

function Surfaces({ surface }: { surface: Surface }) {
  const show = (name: Exclude<Surface, "all">) => surface === "all" || surface === name;

  return (
    <div className="flex w-full flex-col gap-6 bg-background p-4 text-foreground">
      {show("badge") && (
        <div className="flex items-center gap-2">
          <PlanBadge />
        </div>
      )}
      {show("pricing") && (
        <PricingTable numberOfColumns={2} showFeatureComparison={false} showAnnualToggle />
      )}
      {show("paywall") && <DeferredPaywall />}
      {show("portal") && <CustomerPortal layout="vertical" />}
    </div>
  );
}

function PreviewPanel({
  mode,
  draft,
  surface,
}: {
  mode: "light" | "dark";
  draft: AppearanceDraft;
  surface: Surface;
}) {
  // The panels always show both modes — that is the point of the split — while
  // `draft.baseTheme` stays a property of the config being written, flagged below.
  // Each panel resolves the palette for ITS mode: `variables` plus whatever the
  // per-mode bucket layers over it. `baseTheme` is pinned to the panel so the two
  // always show both modes — the config's own baseTheme is a flag in the header.
  const appearance = React.useMemo(
    () => ({ baseTheme: mode, variables: { ...draft.variables, ...draft.modes[mode] } }),
    [mode, draft.variables, draft.modes],
  );

  return (
    <Card className="ktnpg-panel gap-0 overflow-hidden py-0" data-mode={mode}>
      <header className="bg-muted text-muted-foreground flex items-center gap-2 border-b px-3 py-1.5 text-[11px] tracking-wide uppercase">
        <span>{mode}</span>
        {draft.baseTheme === mode && <Badge variant="secondary">baseTheme</Badge>}
        {draft.baseTheme === "system" && <Badge variant="secondary">follows OS</Badge>}
      </header>
      {/* The frame is chrome and reads the SDK's own tokens; everything below this line
          is the themed preview, with its own root and the draft applied to it. */}
      <div className="ktnpg-panel-body">
        <KaitenStyleRoot appearance={appearance}>
          <Surfaces surface={surface} />
        </KaitenStyleRoot>
      </div>
    </Card>
  );
}

function VariableRow({
  entry,
  draft,
  scope,
  fallback,
  onChange,
}: {
  entry: VariableEntry;
  draft: AppearanceDraft;
  scope: VariableScope;
  fallback: string | undefined;
  onChange: (key: VariableKey, value: string | undefined) => void;
}) {
  // The field edits ONE bucket — the selected scope — but shows what the key
  // resolves to there, inherited value included. Editing `dark` while a `both`
  // value exists otherwise looks like an empty field over a coloured swatch.
  const value = bucketOf(draft, scope)[entry.key];
  const inheritedFromBoth = scope !== "both" ? draft.variables[entry.key] : undefined;
  const palette =
    scope === "both" ? draft.variables : { ...draft.variables, ...draft.modes[scope] };
  const derived = derivedValueFor(palette, entry.key);
  const source = DERIVED_FROM[entry.key];

  // What the swatch shows when the key is unset: the derived value if one is coming,
  // otherwise the SDK's own resolved token read off a live element. Never written into
  // the draft — displaying a default and exporting it are different things.
  const shown = value ?? inheritedFromBoth ?? derived ?? fallback ?? "";
  const isColor = entry.kind === "color";
  const swatchValue = HEX.test(shown) ? shown : "#000000";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label
        className={`flex items-center gap-1.5 text-xs ${value === undefined ? "text-muted-foreground" : "text-foreground"}`}
        htmlFor={`ktnpg-${entry.key}`}
      >
        {entry.label}
        {value === undefined && inheritedFromBoth !== undefined && (
          <Badge variant="secondary" title="Set for both modes — edit the `both` scope">
            both
          </Badge>
        )}
        {value === undefined && inheritedFromBoth === undefined && derived !== undefined && (
          <Badge variant="secondary" title={`Derived from ${source} by the SDK`}>
            derived
          </Badge>
        )}
      </label>
      <div className="flex items-center gap-1.5">
        {isColor && (
          <input
            aria-label={`${entry.label} colour`}
            className="ktnpg-swatch border-input bg-background size-8 shrink-0 rounded-md border"
            disabled={!HEX.test(shown) && shown !== ""}
            onChange={(event) => onChange(entry.key, event.target.value)}
            type="color"
            value={swatchValue}
          />
        )}
        <Input
          className="h-8 font-ktn-mono text-xs"
          id={`ktnpg-${entry.key}`}
          onChange={(event) => onChange(entry.key, event.target.value)}
          placeholder={shown || "unset"}
          spellCheck={false}
          value={value ?? ""}
        />
        <Button
          aria-label={`Reset ${entry.label}`}
          disabled={value === undefined}
          onClick={() => onChange(entry.key, undefined)}
          size="icon-xs"
          title="Back to the SDK default"
          variant="ghost"
        >
          ×
        </Button>
      </div>
    </div>
  );
}

/** Key names the import could not fill, rendered as one line of monospace. */
function MissingNote({ label, keys }: { label: string; keys: VariableKey[] }) {
  if (keys.length === 0) return null;

  return (
    <p className="text-muted-foreground text-[11px] leading-relaxed">
      {label} <code className="font-ktn-mono break-all">{keys.join(", ")}</code>
    </p>
  );
}

function ShadcnImport({
  onApply,
}: {
  onApply: (variables: Partial<Record<VariableKey, string>>) => void;
}) {
  const [css, setCss] = React.useState("");
  const [result, setResult] = React.useState<ShadcnImportResult | null>(null);

  const blocks = result
    ? ([result.light, result.dark].filter(Boolean) as NonNullable<ShadcnImportResult["light"]>[])
    : [];

  return (
    <details className="group">
      <summary className="text-foreground cursor-pointer text-xs font-semibold tracking-wide uppercase">
        Import from shadcn
      </summary>
      <p className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
        Paste <code className="font-ktn-mono">globals.css</code> — or just its{" "}
        <code className="font-ktn-mono">:root</code> / <code className="font-ktn-mono">.dark</code>{" "}
        block. Bare HSL triplets, <code className="font-ktn-mono">hsl(…)</code> and hex are all
        understood.
      </p>
      <textarea
        aria-label="shadcn globals.css"
        className={`${SELECT_CLASS} font-ktn-mono mt-2 h-28 resize-y py-2 text-xs`}
        onChange={(event) => setCss(event.target.value)}
        placeholder={":root {\n  --primary: 222.2 47.4% 11.2%;\n  --radius: 0.5rem;\n}"}
        spellCheck={false}
        value={css}
      />
      <Button className="mt-2" onClick={() => setResult(parseShadcnCss(css))} size="sm">
        Parse
      </Button>

      {result && (
        <div className="mt-3 space-y-2">
          {result.warnings.map((warning) => (
            // Colour as an accent on the border, not on the text: `--ktn-warning` is
            // #d97706, which does not clear AA as body text on a light surface, and the
            // a11y addon fails this story on contrast violations.
            <p
              className="border-ktn-warning text-foreground border-l-2 pl-2 text-[11px] leading-relaxed"
              key={warning}
            >
              {warning}
            </p>
          ))}
          {blocks.map((block) => (
            <Card className="gap-2 py-3" key={block.selector}>
              <CardContent className="space-y-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="font-ktn-mono text-xs">{block.selector}</code>
                  <Button onClick={() => onApply(block.variables)} size="xs">
                    Apply {Object.keys(block.variables).length} tokens
                  </Button>
                </div>
                <MissingNote
                  label="No Kaiten equivalent, skipped:"
                  keys={block.unmapped as never}
                />
                <MissingNote
                  label="shadcn has no source for these, so they keep the SDK default:"
                  keys={block.missing
                    .filter((entry) => entry.reason === "no-source")
                    .map((entry) => entry.key)}
                />
                <MissingNote
                  label="Derived from their fill, nothing to import:"
                  keys={block.missing
                    .filter((entry) => entry.reason === "derived")
                    .map((entry) => entry.key)}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </details>
  );
}

export function ThemePlayground() {
  const [draft, setDraft] = React.useState<AppearanceDraft>(EMPTY_DRAFT);
  // Which bucket the fields write to. `both` is the honest default: most tokens
  // — a brand colour, a radius, a typeface — mean the same thing in either mode,
  // and only surfaces usually need to differ.
  const [scope, setScope] = React.useState<VariableScope>("both");
  const [surface, setSurface] = React.useState<Surface>("all");
  /** Which panel is on screen when there is only room for one. */
  const [preview, setPreview] = React.useState<"light" | "dark">("light");
  const [copied, setCopied] = React.useState(false);
  const [defaults, setDefaults] = React.useState<Partial<Record<VariableKey, string>>>({});
  const probe = React.useRef<HTMLDivElement>(null);

  // The SDK's resolved tokens, read off a real element rather than restated here.
  // `themes.ts` records what a hand-copied table costs: its `default` preset drifted
  // from the shipped values and quietly broke contrast.
  //
  // Re-read whenever the ambient colour scheme changes, not once on mount. The probe
  // resolves against whatever `.dark` is in force above it, so a mount-time snapshot
  // froze one scheme's values: flipping Storybook's theme toolbar afterwards re-rendered
  // the panels correctly while every "SDK default" placeholder kept showing the other
  // mode's colour — `#111019` offered as the default card on a light preview.
  React.useEffect(() => {
    const read = () => {
      const element = probe.current;
      if (!element) return;
      const computed = getComputedStyle(element);
      setDefaults(
        Object.fromEntries(
          ALL_KEYS.map((key) => [key, computed.getPropertyValue(CSS_VAR_OF[key]).trim()]),
        ),
      );
    };

    read();

    // `withThemeByClassName` toggles the class on <html>; the token block keys off it
    // (`.kaiten.dark, .dark .kaiten`), so that attribute is the whole signal.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Follow the config being written: choosing `midnight` should not leave you looking at
  // the light panel. Keyed on `baseTheme` alone, so a manual switch afterwards sticks —
  // this only re-runs when the config's own mode changes. `"system"` has no one answer,
  // so it leaves whatever is on screen alone.
  React.useEffect(() => {
    if (draft.baseTheme !== "system") setPreview(draft.baseTheme);
  }, [draft.baseTheme]);

  const setVariable = React.useCallback(
    (key: VariableKey, value: string | undefined) => {
      setCopied(false);
      setDraft((current) => {
        const bucket = { ...bucketOf(current, scope) };
        // An empty field means "unset", not "the empty string" — otherwise clearing an
        // input would export `colorPrimary: ""` and paint nothing.
        if (value === undefined || value.trim() === "") delete bucket[key];
        else bucket[key] = value;

        return scope === "both"
          ? { ...current, variables: bucket }
          : { ...current, modes: { ...current.modes, [scope]: bucket } };
      });
    },
    [scope],
  );

  const source = React.useMemo(() => toAppearanceSource(draft), [draft]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
    } catch {
      // Clipboard access is origin- and permission-gated, and Storybook runs in an
      // iframe. The code is on screen and selectable either way, so say so rather
      // than pretending it worked.
      setCopied(false);
      window.alert("Clipboard blocked here — select the config below and copy it manually.");
    }
  };

  return (
    /*
     * The chrome is built from the SDK's own primitives, and reads the SDK's own tokens
     * rather than the draft: it sits in the story's outer `.kaiten`, while the draft is
     * applied by the `KaitenStyleRoot` inside each preview panel. That separation is what
     * makes dogfooding safe here — setting `colorBackground` to black themes the previews
     * and leaves the controls you need in order to undo it perfectly legible.
     */
    <div className="ktnpg text-foreground">
      <style>{PLAYGROUND_CSS}</style>
      {/* Hidden, unstyled by the draft: the source of the "SDK default" swatch values. */}
      <div className="kaiten" ref={probe} style={{ display: "none" }} />

      <div className="ktnpg-layout">
        <Card className="ktnpg-editor py-4">
          <CardContent className="space-y-3 px-4">
            <div className="ktnpg-toolbar">
              <label className="flex min-w-0 flex-col gap-1">
                <span className={LABEL_CLASS}>Preset</span>
                <select
                  aria-label="Preset"
                  className={SELECT_CLASS}
                  onChange={(event) => {
                    const preset = themes[event.target.value as keyof typeof themes];
                    setCopied(false);
                    // A preset is a palette; the mode is the select next door.
                    // Presets used to carry a baseTheme and picking one flipped
                    // the whole playground dark — the coupling this editor
                    // exists to demonstrate against.
                    // A preset carries its surfaces per mode now, so it replaces
                    // both buckets — otherwise the previous theme's dark surfaces
                    // would survive under the new brand colour.
                    setDraft((previous) => ({
                      baseTheme: previous.baseTheme,
                      variables: { ...preset.variables },
                      modes: {
                        light: { ...(preset as KaitenAppearance).modes?.light },
                        dark: { ...(preset as KaitenAppearance).modes?.dark },
                      },
                    }));
                  }}
                  defaultValue=""
                >
                  <option disabled value="">
                    Start from…
                  </option>
                  {Object.keys(themes).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-0 flex-col gap-1">
                <span className={LABEL_CLASS}>baseTheme</span>
                <select
                  aria-label="baseTheme"
                  className={SELECT_CLASS}
                  onChange={(event) => {
                    setCopied(false);
                    setDraft((current) => ({
                      ...current,
                      baseTheme: event.target.value as AppearanceDraft["baseTheme"],
                    }));
                  }}
                  value={draft.baseTheme}
                >
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                  <option value="system">system</option>
                </select>
              </label>

              <label className="flex min-w-0 flex-col gap-1">
                <span className={LABEL_CLASS}>Editing</span>
                <select
                  aria-label="Editing scope"
                  className={SELECT_CLASS}
                  onChange={(event) => setScope(event.target.value as VariableScope)}
                  value={scope}
                >
                  {VARIABLE_SCOPES.map((option) => (
                    <option key={option} value={option}>
                      {option === "both" ? "both modes" : `${option} only`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1">
                <span className={LABEL_CLASS}>Surface</span>
                <select
                  aria-label="Surface"
                  className={SELECT_CLASS}
                  onChange={(event) => setSurface(event.target.value as Surface)}
                  value={surface}
                >
                  {SURFACES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <Button
                disabled={!isDirty(draft)}
                onClick={() => {
                  setDraft(EMPTY_DRAFT);
                  setCopied(false);
                }}
                size="sm"
                variant="outline"
              >
                Reset all
              </Button>
            </div>

            <Separator />
            <ShadcnImport
              onApply={(variables) => {
                setCopied(false);
                setDraft((current) => ({
                  ...current,
                  variables: { ...current.variables, ...variables },
                }));
              }}
            />

            {VARIABLE_GROUPS.map((group) => (
              <section key={group.title}>
                <Separator className="mb-3" />
                <div className="ktnpg-group">
                  <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                    {group.title}
                  </h3>
                  <p className="text-muted-foreground text-[11px] leading-relaxed">{group.blurb}</p>
                  {group.entries.map((entry) => (
                    <VariableRow
                      draft={draft}
                      entry={entry}
                      fallback={defaults[entry.key]}
                      key={entry.key}
                      onChange={setVariable}
                      scope={scope}
                    />
                  ))}
                </div>
              </section>
            ))}
          </CardContent>
        </Card>

        <main className="ktnpg-preview">
          {/*
           * Both panels are always rendered; CSS decides whether you get the pair or one
           * at a time, so switching never remounts a preview or refetches its data.
           * The switch itself is hidden once both fit, where it would have nothing to
           * choose.
           */}
          {/* Same idiom as the pricing table's own Monthly/Annual toggle — primary fill
              for the selected option — so the playground's one bespoke control still
              reads as part of the design system. */}
          <div
            aria-label="Preview colour scheme"
            className="ktnpg-switch bg-card inline-flex w-fit items-center rounded-ktn-lg border p-1"
            role="radiogroup"
          >
            {(["light", "dark"] as const).map((mode) => (
              <button
                aria-checked={preview === mode}
                className={`rounded-ktn-md px-3 py-1 text-xs tracking-wide uppercase transition-colors ${
                  preview === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
                key={mode}
                onClick={() => setPreview(mode)}
                role="radio"
                type="button"
              >
                {mode}
              </button>
            ))}
          </div>

          <PlaygroundProvider>
            <div className="ktnpg-panels" data-preview={preview}>
              <PreviewPanel draft={draft} mode="light" surface={surface} />
              <PreviewPanel draft={draft} mode="dark" surface={surface} />
            </div>
          </PlaygroundProvider>

          <Card className="py-4">
            <CardContent className="space-y-2 px-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                  appearance config
                </h3>
                <Button onClick={copy} size="sm" variant="outline">
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {/* Stable hook for the story assertions: the styling is all utilities, so
                  there is no longer a class here worth selecting on. */}
              <pre
                className="bg-muted font-ktn-mono overflow-x-auto rounded-md p-3 text-xs leading-relaxed"
                data-ktnpg="config"
              >
                {source}
              </pre>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Only the keys you changed are emitted — the SDK owns the rest, and a config that
                restates today&apos;s defaults stops tracking them the moment they move.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
