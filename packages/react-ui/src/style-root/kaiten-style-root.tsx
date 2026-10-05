import * as React from "react";
import { clsx } from "clsx";
import { useKaitenAvailable } from "@kaitencloud/react";

import { buildAppearanceStyle } from "../appearance/apply.ts";
import { AppearanceProvider, useMergedAppearance } from "../appearance/context.tsx";
import type { KaitenAppearance } from "../appearance/types.ts";

interface StyleRootContextValue {
  /**
   * A host's portals (Radix, Base UI, floating-ui…) mount here so the CSS
   * variables under `.kaiten` apply to them. The SDK itself mounts none: its
   * modal is the native `<dialog>`, rendered in place and lifted by the top layer.
   */
  portalContainer: HTMLElement | null;
}

const StyleRootContext = /* @__PURE__ */ React.createContext<StyleRootContextValue | null>(null);

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

/**
 * The portal mount node of the nearest `KaitenStyleRoot`, or `null` when there is
 * none (portal libraries fall back to `document.body`).
 */
export function useKaitenPortalContainer(): HTMLElement | null {
  return React.useContext(StyleRootContext)?.portalContainer ?? null;
}

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * The colour mode the SDK subtree declares — or `"inherit"`, which declares
 * nothing and lets the host page decide through `.dark .kaiten`.
 *
 * Three states rather than a boolean, because "not dark" and "light" are
 * different claims: an embedded widget with no `baseTheme` should darken with
 * the page around it, while `baseTheme: "light"` has to hold even there. The
 * stylesheet spells that out as `.dark .kaiten:not(.ktn-light)`, so the class
 * this returns is the whole enforcement mechanism.
 *
 * Read through `useSyncExternalStore` rather than an effect so the first paint is
 * already correct — an effect would flash the light theme — and so server rendering
 * has a defined answer instead of touching `matchMedia`. The server snapshot for
 * `"system"` is `"inherit"`: the preference is not knowable there, and deferring
 * to the host is never worse than forcing light, then hydration corrects it.
 */
type ResolvedColorMode = "inherit" | "light" | "dark";

function useResolvedColorMode(baseTheme: KaitenAppearance["baseTheme"]): ResolvedColorMode {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      if (baseTheme !== "system" || typeof window === "undefined") return () => {};
      const query = window.matchMedia(DARK_SCHEME_QUERY);
      query.addEventListener("change", onStoreChange);
      return () => query.removeEventListener("change", onStoreChange);
    },
    [baseTheme],
  );

  const getSnapshot = React.useCallback((): ResolvedColorMode => {
    if (baseTheme === undefined) return "inherit";
    if (baseTheme !== "system") return baseTheme;
    if (typeof window === "undefined") return "inherit";
    return window.matchMedia(DARK_SCHEME_QUERY).matches ? "dark" : "light";
  }, [baseTheme]);

  const getServerSnapshot = React.useCallback(
    (): ResolvedColorMode =>
      baseTheme === undefined || baseTheme === "system" ? "inherit" : baseTheme,
    [baseTheme],
  );

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** `"inherit"` deliberately stamps nothing — that is what lets the host decide. */
function colorModeClass(mode: ResolvedColorMode): string | false {
  if (mode === "dark") return "dark";
  return mode === "light" && "ktn-light";
}

/**
 * Classes on the scope root — the `<div class="kaiten">` that hosts the `--ktn-*`
 * tokens and anchors every scoped style.
 *
 * `w-full` is there because this box is a style scope, not a layout participant, and it
 * must not be the thing that decides how wide the SDK is. In block flow it changes
 * nothing. In a flex or grid parent it does: with no width the wrapper shrink-to-fits,
 * so it asks its contents how wide they would like to be — and a
 * `repeat(auto-fit, …)` grid answers "one column", because auto-fit exists to read an
 * available width that shrink-to-fit has not decided yet. A host writing
 * `display: flex; justify-content: center` around the root therefore got a
 * one-column pricing table on a 1280px page. Measured on that exact story: 512px
 * wrapper and one column without this class, 1200px and three columns with it.
 *
 * Same rule as `@container/ktn` needing `w-full`, and the same reason — an element
 * sized by its contents cannot also tell those contents how much room they have.
 */
const SCOPE_ROOT_CLASS = "kaiten w-full";

/** Warn once per component, so StrictMode's double render doesn't double the noise. */
const warnedMissingStyleRoot = new Set<string>();

/**
 * What every styled component calls first: it must sit under a `<KaitenProvider>`
 * for its data, and under a `<KaitenStyleRoot>` for its styles.
 *
 * The first is an error — nothing can render without the data. The second is a
 * development warning: with no `.kaiten` ancestor every scoped rule misses and the
 * component comes out unstyled, and silently looking broken is the worst outcome.
 */
export function useAssertWrappedByKaitenProvider(componentName: string): void {
  const hasProvider = useKaitenAvailable();
  if (!hasProvider) {
    throw new Error(
      `<${componentName}> must be used within a <KaitenProvider>. Wrap your component tree with <KaitenProvider>.`,
    );
  }

  const styleRoot = React.useContext(StyleRootContext);
  if (styleRoot === null && !isProduction() && !warnedMissingStyleRoot.has(componentName)) {
    warnedMissingStyleRoot.add(componentName);
    console.warn(
      `[@kaitencloud/react-ui] <${componentName}> renders styled markup, but no <KaitenStyleRoot> is mounted above it. ` +
        `Every SDK style is scoped to the \`.kaiten\` element that root renders, so this will render unstyled. ` +
        `Wrap the subtree — or the whole app — in <KaitenStyleRoot>, inside the <KaitenProvider>.`,
    );
  }
}

export interface KaitenStyleRootProps {
  /**
   * Tokens, icons and colour mode for this subtree, merged over any
   * `KaitenStyleRoot` above it. Theme presets (`themes.*`) are `KaitenAppearance`
   * objects and go here as they are.
   */
  appearance?: KaitenAppearance;
  children: React.ReactNode;
}

/**
 * The element every SDK style is scoped to.
 *
 * `KaitenProvider` carries the data and renders nothing; this renders the
 * `<div class="kaiten">` that hosts the `--ktn-*` tokens, anchors every scoped
 * rule in `@kaitencloud/react-ui/styles.css`, resolves the colour mode and
 * parents the portal container. Mount it inside the provider, around whatever
 * draws — the whole app, or one route:
 *
 * ```tsx
 * <KaitenProvider mode="authenticated" {...config}>
 *   <App />                    {/* Gate, hooks — no wrapper anywhere *\/}
 *   <Route path="/billing">
 *     <KaitenStyleRoot><CustomerPortal /></KaitenStyleRoot>
 *   </Route>
 * </KaitenProvider>
 * ```
 *
 * One per subtree is enough. A nested root merges its `appearance` over the
 * outer one's, so a route can restyle its widgets without a second provider.
 */
export function KaitenStyleRoot({ appearance, children }: KaitenStyleRootProps) {
  const hasProvider = useKaitenAvailable();
  if (!hasProvider) {
    throw new Error(
      "<KaitenStyleRoot> must be used within a <KaitenProvider>. Wrap your component tree with <KaitenProvider>.",
    );
  }

  const portalHostId = React.useId();
  const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
  const setPortalRef = React.useCallback((node: HTMLDivElement | null) => {
    setPortalContainer(node);
  }, []);

  const merged = useMergedAppearance(appearance);
  const colorMode = useResolvedColorMode(merged.baseTheme);
  const styleOverrides = buildAppearanceStyle(merged);

  const value = React.useMemo<StyleRootContextValue>(
    () => ({ portalContainer }),
    [portalContainer],
  );

  return (
    <AppearanceProvider appearance={merged}>
      <StyleRootContext.Provider value={value}>
        <div className={clsx(SCOPE_ROOT_CLASS, colorModeClass(colorMode))} style={styleOverrides}>
          {children}
          <div
            ref={setPortalRef}
            id={`kaiten-portal-host-${portalHostId.replace(/:/g, "")}`}
            data-slot="kaiten-portal-host"
            className="ktn-own kaiten absolute top-0 left-0 isolate h-0 w-0 overflow-visible"
            style={{ zIndex: "var(--ktn-z-portal)" }}
          />
        </div>
      </StyleRootContext.Provider>
    </AppearanceProvider>
  );
}
