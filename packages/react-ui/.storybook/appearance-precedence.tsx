// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// `import.meta.glob` below is a Vite API. A file-local reference rather than a
// program-level `types` entry, for the same reason `preview.tsx` needs one for `*.css`:
// the lint pass and `tsgo` do not resolve the ambient set identically.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference types="vite-plus/client" />

import * as React from "react";

import { resolveVariables } from "../src/appearance/apply.ts";

/**
 * Harness for `Integration/Appearance precedence`.
 *
 * It lives here rather than beside its story because `src/styles/kaiten.css` scans
 * `src/**` to decide which utilities to emit into the published `dist/kaiten.css`.
 * Written in `src/`, this file's `h-24`, `border-0` and `text-destructive` were added
 * to the stylesheet every customer downloads — three rules that exist only to lay out
 * a test harness. Out here it contributes nothing.
 *
 * The question it answers: does `appearance.variables` still win once the SDK is
 * dropped into a host running its own Tailwind build?
 *
 * It asks against the artifact customers actually install — `dist/kaiten.css` — and not
 * against the stylesheet Storybook normally renders with. The two are not the same
 * file, and the difference is the whole point:
 *
 * - `.storybook/preview.tsx` imports `src/styles/kaiten.css`, which `@tailwindcss/vite`
 *   compiles in-process. That output is *unscoped* — plain `.bg-primary` at document
 *   scope, exactly the shape that shipped before `ac12ec3`.
 * - The published file is post-processed by `scripts/scope-kaiten-css.ts` into
 *   `.bg-primary:is(.kaiten,.kaiten *)`, and only `vp pack` produces it.
 *
 * So the ordinary Storybook cascade cannot observe the regression this guards: every
 * other story in this package renders against CSS that never had the fix applied.
 * `tests/scope-css.test.ts` reads the built file but checks it *textually* — that no
 * generated selector escaped the scope. Neither answers the behavioural question a
 * theme editor's output depends on: put a host's conflicting `.bg-primary` in the same
 * document and does an override still reach the button?
 *
 * Hence the iframe. It is not ceremony — it is the only way to get a cascade in this
 * package that contains the real stylesheet and nothing else.
 *
 * The answer is now "yes, in either arrangement and either import order" — the
 * published stylesheet is unlayered, so it competes on specificity rather than being
 * outranked wholesale. It was "no" against an unlayered host until then, and the third
 * story pins the way a host takes precedence back. See `HOST_UNLAYERED`.
 */
export const distCss = Object.values(
  import.meta.glob("../dist/kaiten.css", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
)[0] as string | undefined;

/** Overrides a themer would produce. Deliberately nothing like the defaults. */
const OVERRIDES = {
  colorPrimary: "#0f766e",
  borderRadius: "0.25rem",
} as const;

export const EXPECTED = {
  /** `#0f766e` — the override itself. */
  primary: "rgb(15, 118, 110)",
  /** `readableForegroundFor("#0f766e")` → white, derived rather than authored. */
  primaryForeground: "rgb(255, 255, 255)",
  /** `0.25rem` at the default 16px root. */
  radius: "4px",
  /** `#dc2626` — the host's own `--primary`, which must survive outside `.kaiten`. */
  hostPrimary: "rgb(220, 38, 38)",
  hostRadius: "24px",
} as const;

const HOST_TOKENS = `
  :root {
    --primary: #dc2626;
    --primary-foreground: #fef2f2;
    --radius: 1.5rem;
  }
`;

const HOST_UTILITIES = `
  .bg-primary { background-color: var(--primary); }
  .text-primary-foreground { color: var(--primary-foreground); }
  .rounded-lg { border-radius: var(--radius); }
`;

/**
 * A host on Tailwind v4, which emits its utilities into native cascade layers.
 *
 * The SDK is unlayered and so outranks the host's layered utilities outright. Even at
 * equal footing it would win: `.bg-primary:is(.kaiten,.kaiten *)` carries two classes
 * against the host's one, the margin `ac12ec3` bought. Either way it holds in both
 * import orders — which was the actual bug, since load order used to decide.
 */
export const HOST_TAILWIND_V4 = `
  @layer theme, base, components, utilities;
  ${HOST_TOKENS}
  @layer utilities { ${HOST_UTILITIES} }
`;

/**
 * The same host tokens written *outside* any layer — Tailwind v3, hand-written CSS, or
 * anything else that emits plain rules.
 *
 * This is the arrangement the SDK used to lose in, and the reason it ships unlayered
 * today. An unlayered declaration outranks every layered one no matter how specific the
 * layered selector is, so while the utilities sat in `@layer utilities` the host won
 * inside `.kaiten` and `appearance.variables` was inert — the custom property was still
 * set on the element, but no SDK rule survived to read it. Two classes against one now
 * settles it instead.
 *
 * It stays asserted rather than assumed. The playground generates config against this
 * substrate, and it is also the majority of the shadcn market, so the arrangement that
 * used to silently do nothing is the one the suite should defend hardest.
 */
export const HOST_UNLAYERED = `${HOST_TOKENS}${HOST_UTILITIES}`;

/**
 * Markup mirroring what `Button` renders (`bg-primary text-primary-foreground`) plus a
 * host-owned twin outside the SDK root, so one document answers both halves of the
 * guarantee: the host must not reach in, and the SDK must not leak out.
 */
function iframeMarkup(styleAttr: string): string {
  return `
    <button id="host-probe" class="bg-primary text-primary-foreground rounded-lg">Host</button>
    <div class="kaiten" style="${styleAttr}">
      <button id="themed-probe" class="bg-primary text-primary-foreground rounded-lg">Upgrade</button>
    </div>
  `;
}

/** Serialises the provider's real output, so the test exercises that code path too. */
function inlineStyleAttribute(): string {
  const style = resolveVariables(OVERRIDES);
  if (!style) throw new Error("resolveVariables returned nothing for a non-empty override");
  return Object.entries(style)
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");
}

export function PrecedenceHarness({
  hostCss,
  sdkLayer,
}: {
  hostCss: string;
  /** Mirrors `@import … layer(name)`, the host's way of ranking the SDK below its own CSS. */
  sdkLayer?: string;
}) {
  const ref = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;

    const sdk = distCss ?? "";
    // Host sheet last: at equal specificity the later rule wins, so this is the import
    // order that used to break the SDK outright.
    doc.open();
    doc.write(
      `<!doctype html><html><head>` +
        `<style id="sdk">${sdkLayer ? `@layer ${sdkLayer}{${sdk}}` : sdk}</style>` +
        `<style id="host">${hostCss}</style>` +
        `</head><body style="margin:0;padding:16px;display:flex;gap:12px;font:14px system-ui">` +
        iframeMarkup(inlineStyleAttribute()) +
        `</body></html>`,
    );
    doc.close();
  }, [hostCss, sdkLayer]);

  if (!distCss) {
    return (
      <p style={{ color: "#b42318", font: "13px ui-sans-serif, system-ui" }}>
        <code>dist/kaiten.css</code> is missing — run <code>vp run build</code> in{" "}
        <code>packages/react</code>. This story asserts against the published stylesheet, so there
        is nothing meaningful to check without it.
      </p>
    );
  }

  return (
    <div style={{ font: "13px ui-sans-serif, system-ui", width: "100%" }}>
      <p style={{ color: "#5c6672", margin: "0 0 10px" }}>
        Left: a host-owned button. Right: the same classes inside <code>.kaiten</code> with an{" "}
        <code>appearance.variables</code> override. One document, host stylesheet loaded last.
      </p>
      <iframe
        ref={ref}
        title="Appearance precedence harness"
        style={{ border: 0, height: 96, width: "100%" }}
      />
    </div>
  );
}
