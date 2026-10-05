import type * as React from "react";

export interface KaitenIconProps {
  className?: string;
}

export type KaitenIconComponent = React.ComponentType<KaitenIconProps>;

export interface KaitenIcons {
  check?: KaitenIconComponent;
  x?: KaitenIconComponent;
  alertTriangle?: KaitenIconComponent;
  lock?: KaitenIconComponent;
  arrowUpRight?: KaitenIconComponent;
  arrowRight?: KaitenIconComponent;
  creditCard?: KaitenIconComponent;
  plus?: KaitenIconComponent;
  zap?: KaitenIconComponent;
  shield?: KaitenIconComponent;
  chevronRight?: KaitenIconComponent;
  loader?: KaitenIconComponent;
  infinity?: KaitenIconComponent;
}

export type KaitenZIndex = number | string;

/**
 * Token overrides. Every key maps to one `--ktn-*` custom property.
 *
 * Used twice on `KaitenAppearance`: as `variables` for what holds in either
 * colour mode, and inside `modes` for what does not.
 */
export interface KaitenVariables {
  colorPrimary?: string;
  /**
   * Text rendered on `colorPrimary`. Every other fill already exposed its pair;
   * this one did not, so overriding the brand colour had no way to keep the label
   * on it readable. Omit it and a readable value is derived from the fill.
   */
  colorPrimaryForeground?: string;
  /** Hover fill. Derived from `colorPrimary` when omitted. */
  colorPrimaryHover?: string;
  /**
   * The page surface. Setting it alone rebuilds the whole neutral family —
   * foreground, card, popover, muted, secondary, border, input, and their
   * text colours — so a dark background never renders with the light theme's
   * white cards on top. Any of them set explicitly wins over the derivation.
   */
  colorBackground?: string;
  colorForeground?: string;
  colorCard?: string;
  colorCardForeground?: string;
  colorDestructive?: string;
  colorDestructiveForeground?: string;
  /** Hover fill. Derived from `colorDestructive` when omitted. */
  colorDestructiveHover?: string;
  /** Tinted destructive surface (inline error panels) and the text on it. */
  colorDestructiveSubtle?: string;
  colorDestructiveSubtleForeground?: string;
  colorSuccess?: string;
  colorSuccessForeground?: string;
  /** Hover fill. Derived from `colorSuccess` when omitted. */
  colorSuccessHover?: string;
  colorMuted?: string;
  colorMutedForeground?: string;
  colorSecondary?: string;
  colorSecondaryForeground?: string;
  /** Hover fill. Derived from `colorSecondary` when omitted. */
  colorSecondaryHover?: string;
  colorAccent?: string;
  colorAccentForeground?: string;
  /** Hover fill. Derived from `colorAccent` when omitted. */
  colorAccentHover?: string;
  colorPopover?: string;
  colorPopoverForeground?: string;
  colorInput?: string;
  colorBorder?: string;
  colorRing?: string;
  borderRadius?: string;
  fontFamily?: string;
}

export interface KaitenAppearance {
  /**
   * Colour mode for the SDK subtree. **Omit it and the SDK follows the host
   * page** — a `dark` class on any ancestor darkens the widgets with it, which
   * is what an embedded component should do when the integrator says nothing.
   *
   * `"light"` and `"dark"` are declarations and always win, including inside a
   * dark host page. (They did not: an inheritance heuristic in the stylesheet
   * outranked the prop, so `"light"` was unenforceable on a `.dark` page.)
   *
   * `"system"` follows the visitor's `prefers-color-scheme` and keeps following
   * it if they change it mid-session — use it when the host page has no colour
   * mode of its own to inherit.
   */
  baseTheme?: "light" | "dark" | "system";
  /**
   * Stacking level of the provider's portal host, the element
   * `useKaitenPortalContainer()` returns for a host's own portals. Defaults to
   * 100. The SDK's own modal is the native `<dialog>` in the top layer, which
   * no z-index reaches.
   */
  zIndex?: KaitenZIndex;
  variables?: KaitenVariables;
  /**
   * Per-colour-mode palettes, layered over `variables`.
   *
   * `variables` is what holds in either mode — a brand colour, a radius, a
   * typeface. Surfaces usually do not: a slate page needs light text, and the
   * same values in a light page would be unreadable. Put those here and each
   * mode gets its own, resolved by the cascade rather than by React — so it is
   * still right when the HOST drives dark with a CSS class the SDK never sees,
   * and during server rendering, where no preference is knowable.
   *
   * ```tsx
   * appearance={{
   *   variables: { colorPrimary: "#7c3aed" },        // both modes
   *   modes: {
   *     light: { colorBackground: "#f8fafc" },
   *     dark: { colorBackground: "#0f172a" },        // surfaces derive from each
   *   },
   * }}
   * ```
   *
   * A key in both wins here, for that mode only.
   */
  modes?: {
    light?: KaitenVariables;
    dark?: KaitenVariables;
  };
  elements?: {
    card?: string;
    cardHeader?: string;
    cardTitle?: string;
    cardDescription?: string;
    cardContent?: string;
    cardFooter?: string;
    button?: string;
    badge?: string;
    table?: string;
    tableRow?: string;
    tableHead?: string;
    tableCell?: string;
    skeleton?: string;
    separator?: string;
    portalSection?: string;
    usageBar?: string;
    usageBarFill?: string;
    paywallOverlay?: string;
    paywallCard?: string;
    pricingCard?: string;
    pricingCardHighlight?: string;
    gateLockedIcon?: string;
    portalGrid?: string;
    actionRow?: string;
    pricingTableHeader?: string;
    featureComparisonTable?: string;
  };
  icons?: KaitenIcons;
}
