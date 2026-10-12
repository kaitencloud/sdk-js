import * as React from "react";

import { usePaywallTrigger, useLocalization, type PortalAction } from "@kaitencloud/react";
import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogDescription, DialogTitle } from "../ui/dialog.tsx";
import { ProgressBar } from "../shared/progress-bar.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";

/**
 * `inert` spread onto the masked-content wrappers below.
 *
 * The package supports React 18 (`react: ">=18"`), and the two majors disagree on
 * how `inert` is serialized — so neither boolean nor empty string works on both:
 *
 * | form            | React 18            | React 19            |
 * | --------------- | ------------------- | ------------------- |
 * | `inert={true}`  | dropped (warns)     | `inert=""`          |
 * | `inert=""`      | `inert=""`          | dropped (warns)     |
 * | `inert="inert"` | `inert="inert"`     | `inert=""`          |
 *
 * `"inert"` is the one form that renders the attribute on both. HTML treats
 * `inert` as a boolean attribute, so the value is irrelevant — only its presence.
 * The cast is needed because @types/react 19 narrows the prop to `boolean`.
 *
 * Without this, React 18 silently drops the attribute and the masked content
 * behind the wall stays focusable and exposed to assistive tech.
 */
const INERT = { inert: "inert" } as unknown as { inert?: boolean };

/**
 * Marks a subtree the SDK MOUNTS but did not WRITE.
 *
 * The stylesheet's preflight is scoped to SDK-rendered markup via `.ktn-own`,
 * and `.ktn-own *` covers everything inside a component — including, here, the
 * host's own children, which Paywall renders inside its `data-slot="paywall"`
 * root. This class takes them back out: it is the one place in the SDK where
 * host markup sits under an SDK element, so it is the one place that needs to
 * say so. See scope-kaiten-css.ts.
 */
const HOST_SUBTREE = "ktn-host";

/**
 * Why the wall says WHY it is there, in the DOM.
 *
 * `data-slot="paywall"` told a host that a wall is up and nothing else, so the
 * two questions a host actually asks — is this a quota that ran out, or a
 * feature the plan never included? is this an outage? — had no answer short of
 * duplicating `usePaywallTrigger` beside the component that already computed it.
 * `data-reason` carries `usePaywallTrigger`'s own verdict:
 *
 *   over_limit | near_limit | not_entitled | flag_disabled | error
 *
 * and, because the set is open, whatever reason a later Kaiten billing adds: a
 * reason this component does not know comes up as a wall with the generic wording,
 * the content behind it inert, and `hard` mode shows it as the inline wall, not the
 * dialog, which is kept for the three reasons that name what the customer lacks.
 *
 * It is on every branch that renders a wall, the hard mode's `<dialog>`
 * included, and on the same element as `data-slot`. Analytics can segment on it,
 * CSS can style on it (`[data-reason="error"]`), and an E2E test can assert the
 * cause rather than the symptom. `error` is the one worth naming: it means the
 * entitlement could not be read, so the wall is the fail-closed policy talking,
 * not a decision about this customer.
 */

function ctaLabel(
  action: PortalAction | undefined,
  localization: ReturnType<typeof useLocalization>,
): string {
  switch (action?.type) {
    case "add_quota":
      return localization.paywall.addQuota;
    case "manage_addon":
      return localization.paywall.addAddOn;
    case "contact_sales":
      return localization.paywall.contactSales;
    case "upgrade_plan":
    default:
      return localization.paywall.upgrade;
  }
}

export interface PaywallProps {
  entitlement: string;
  threshold?: number;
  /** Minimum remaining numeric units required before the wrapped content unlocks. */
  min?: number;
  mode?: "soft" | "hard";
  flagKey?: string;
  /**
   * Fail policy when access data can't be loaded. `"block"` (default,
   * fail-closed) shows the paywall so paid content is never revealed during an
   * outage; `"allow"` (fail-open) reveals the wrapped content.
   *
   * It governs the *loading* window too: until access is known, `"block"`
   * renders {@link PaywallProps.loading} rather than the wrapped content.
   */
  onError?: "block" | "allow";
  /**
   * What to render while access is still being resolved, under the default
   * `onError: "block"` policy. Defaults to nothing, like `Show`.
   */
  loading?: React.ReactNode;
  onUpgrade?: (action?: PortalAction) => void;
  onDismiss?: () => void;
  onThresholdReached?: (percentage: number) => void;
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  children: React.ReactNode;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
function PaywallRoot({
  entitlement,
  threshold = 0.8,
  min,
  mode = "soft",
  flagKey,
  onError = "block",
  loading = null,
  onUpgrade,
  onDismiss,
  onThresholdReached,
  appearance,
  unstyled = false,
  children,
}: PaywallProps) {
  useAssertWrappedByKaitenProvider("Paywall");
  useTrackComponent("Paywall");

  const merged = useMergedAppearance(appearance);
  const trigger = usePaywallTrigger(entitlement, { threshold, min, flagKey, onError });
  const icons = useIcons();
  const localization = useLocalization();
  const [dismissed, setDismissed] = React.useState(false);
  // Hard mode only: the modal was closed. The wall stays — see the dialog below.
  const [modalDismissed, setModalDismissed] = React.useState(false);
  const notifiedRef = React.useRef(false);

  React.useEffect(() => {
    if (trigger.shouldShow && !notifiedRef.current) {
      notifiedRef.current = true;
      onThresholdReached?.(trigger.percentage);
    }

    if (!trigger.shouldShow) {
      notifiedRef.current = false;
      // Re-arm: if the user dismissed but usage later drops below the threshold,
      // the paywall should show again the next time it's crossed.
      setDismissed(false);
      setModalDismissed(false);
    }
  }, [onThresholdReached, trigger.percentage, trigger.shouldShow]);

  React.useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    if (
      mode === "hard" &&
      (trigger.reason === "over_limit" ||
        trigger.reason === "not_entitled" ||
        trigger.reason === "flag_disabled") &&
      trigger.shouldShow &&
      !onUpgrade
    ) {
      console.warn(
        '[@kaitencloud/react] Paywall: `mode="hard"` with no `onUpgrade` leaves users without an upgrade action. Provide `onUpgrade` or `onDismiss`.',
      );
    }
  }, [mode, onUpgrade, trigger.reason, trigger.shouldShow]);

  // When the soft wall is up, the masked content underneath must not stay
  // focusable/clickable (keyboard + SR users would tab straight into blocked
  // content). We mark it `inert` in render; here we move focus into the panel and
  // restore it on dismiss. Hard mode uses the native `<dialog>`, whose
  // `showModal()` holds focus itself.
  //
  // Both moves pass `preventScroll` — plain `focus()` scrolls every scrollable
  // ancestor to reveal its target, so an inline wall below the fold would yank the
  // host page down to itself the moment its data resolves, with no user action
  // behind the jump. The focus move is the point; the scroll is not part of it.
  const wallVisible = !trigger.isLoading && trigger.shouldShow && !(dismissed && mode === "soft");
  const overlayRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!wallVisible || mode === "hard") return;
    restoreFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    overlayRef.current
      ?.querySelector<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
      ?.focus({ preventScroll: true });
    return () => restoreFocusRef.current?.focus?.({ preventScroll: true });
  }, [wallVisible, mode]);

  // Access is not known yet. Rendering `children` here revealed the protected
  // content on every first mount — and on every remount, which the provider does
  // whenever its scope key changes — contradicting the fail-closed policy this
  // component documents on `onError`. `Show` already hides during loading and
  // takes a `loading` slot; `Gate` deliberately stays open because the host sees
  // `isLoading` and the server still enforces. Paywall can do neither: it renders
  // the protected content itself, so it follows `onError`.
  if (trigger.isLoading) {
    return onError === "allow" ? <>{children}</> : <>{loading}</>;
  }

  if (!trigger.shouldShow || (dismissed && mode === "soft")) {
    return <>{children}</>;
  }

  const LockIconComp = icons.lock;
  const ArrowIcon = icons.arrowRight;

  const reasonLabel =
    trigger.reason === "over_limit"
      ? localization.paywall.limitReached
      : trigger.reason === "near_limit"
        ? localization.paywall.approachingLimit
        : trigger.reason === "flag_disabled"
          ? localization.paywall.featureUnavailable
          : localization.paywall.notAvailable;

  const badgeVariant =
    trigger.reason === "over_limit" ||
    trigger.reason === "flag_disabled" ||
    trigger.reason === "error"
      ? "destructive"
      : "secondary";

  const description =
    trigger.reason === "error"
      ? localization.paywall.errorDescription
      : trigger.reason === "flag_disabled"
        ? localization.paywall.flagDisabledDescription
        : localization.paywall.usageDescription(
            trigger.current.toLocaleString(),
            trigger.limit.toLocaleString(),
          );

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  if (unstyled) {
    return (
      <div data-slot="paywall" data-reason={trigger.reason ?? undefined} className="ktn-own">
        <div {...INERT} className={HOST_SUBTREE}>
          {children}
        </div>
        <div ref={overlayRef} role="group" aria-label={reasonLabel}>
          <p>{reasonLabel}</p>
          <p>{description}</p>
          {trigger.metered ? (
            <p>
              {trigger.current} / {trigger.limit}
            </p>
          ) : null}
          {onUpgrade ? (
            <button type="button" onClick={() => onUpgrade(trigger.recommendedAction)}>
              {ctaLabel(trigger.recommendedAction, localization)}
            </button>
          ) : null}
          {mode === "soft" ? (
            <button type="button" onClick={handleDismiss}>
              {localization.paywall.dismiss}
            </button>
          ) : null}
          <KaitenBranding unstyled />
        </div>
      </div>
    );
  }

  if (
    mode === "hard" &&
    !modalDismissed &&
    (trigger.reason === "over_limit" ||
      trigger.reason === "not_entitled" ||
      trigger.reason === "flag_disabled")
  ) {
    return (
      <>
        <div {...INERT} className={HOST_SUBTREE}>
          {children}
        </div>
        {/*
         * The wall blocks the FEATURE, not the browser.
         *
         * This dialog used to be a Radix `<Dialog open>` with no `onOpenChange`,
         * no close button, and Escape, outside-click and pointer-down-outside all
         * prevented. A modal traps focus, so with `onUpgrade` absent the card
         * rendered no button at all and a keyboard user had no way out of the
         * dialog OR back to the page — a WCAG 2.1.2 keyboard trap whose only
         * mitigation was a dev-mode console.warn.
         *
         * Closing it costs the gate nothing: `children` are `inert` on every
         * branch, and dismissing the modal falls through to the inline wall below,
         * which keeps them inert and renders no dismiss control in hard mode. The
         * paid content stays unreachable; the page stops being a cage.
         *
         * It is the native `<dialog>` now (see ui/dialog.tsx): a click on the
         * backdrop does nothing there by default, so a stray click cannot drop
         * the modal by accident — Escape and the close button are the deliberate
         * exits.
         */}
        <Dialog data-reason={trigger.reason ?? undefined} onDismiss={() => setModalDismissed(true)}>
          <PaywallCard
            reasonLabel={reasonLabel}
            description={description}
            badgeVariant={badgeVariant}
            trigger={trigger}
            onUpgrade={onUpgrade}
            appearance={merged}
            LockIcon={LockIconComp}
            ArrowIcon={ArrowIcon}
            dialog
            localization={localization}
          />
        </Dialog>
      </>
    );
  }

  return (
    /*
     * The wall is an `absolute inset-0` overlay, so the box the card has to fit into
     * is whatever the host wrapped — and a host gates small things: a button, a
     * toolbar row, a stat. `min-h-20` is the floor the compact wall needs to sit in
     * (`.ktn-paywall-wall` in src/styles/kaiten.css turns the card into a single row
     * below the full card's footprint); without it a one-line child left the card
     * centred on a ~20px box, spilling over the components either side.
     *
     * It is the last class before `paywallOverlay`, so a host that would rather keep
     * its own layout can drop the floor with `min-h-0` and take the spill back.
     */
    <div
      data-slot="paywall"
      data-reason={trigger.reason ?? undefined}
      className={cn("ktn-own", "relative min-h-20", merged.elements?.paywallOverlay)}
    >
      {/* Masked content is inert: not focusable, not clickable, hidden from AT. */}
      <div {...INERT} className={HOST_SUBTREE}>
        {children}
      </div>
      <div
        ref={overlayRef}
        role="group"
        aria-label={reasonLabel}
        className="ktn-paywall-wall absolute inset-0 z-10 rounded-ktn-lg bg-ktn-background/80 backdrop-blur-sm"
      >
        {/* The frame carries the padding, not the wall: a container query cannot
            restyle its own container, and the compact wall tightens both. */}
        <div className="ktn-paywall-frame flex size-full items-center justify-center p-4">
          <PaywallCard
            reasonLabel={reasonLabel}
            description={description}
            badgeVariant={badgeVariant}
            trigger={trigger}
            onUpgrade={onUpgrade}
            onDismiss={mode === "soft" ? handleDismiss : undefined}
            appearance={merged}
            LockIcon={LockIconComp}
            ArrowIcon={ArrowIcon}
            localization={localization}
          />
        </div>
      </div>
    </div>
  );
}

function PaywallCard({
  reasonLabel,
  description,
  badgeVariant,
  trigger,
  onUpgrade,
  onDismiss,
  appearance,
  LockIcon,
  ArrowIcon,
  localization,
  dialog = false,
}: {
  reasonLabel: string;
  description: string;
  badgeVariant: "destructive" | "secondary";
  trigger: ReturnType<typeof usePaywallTrigger>;
  onUpgrade?: (action?: PortalAction) => void;
  onDismiss?: () => void;
  appearance: KaitenAppearance;
  LockIcon: React.ComponentType<{ className?: string }>;
  ArrowIcon: React.ComponentType<{ className?: string }>;
  localization: ReturnType<typeof useLocalization>;
  dialog?: boolean;
}) {
  const title = dialog ? <DialogTitle>{reasonLabel}</DialogTitle> : <span>{reasonLabel}</span>;

  const descriptionNode = dialog ? (
    <DialogDescription className="text-sm text-muted-foreground">{description}</DialogDescription>
  ) : (
    <p className="text-sm text-muted-foreground">{description}</p>
  );

  return (
    /* `ktn-paywall-card` is the compact wall's handle on this card (see
       src/styles/kaiten.css). It is inert outside the soft wall — the rules that use
       it live inside that wall's container query, and the dialog has no container. */
    <Card
      className={cn("ktn-paywall-card w-full max-w-md shadow-lg", appearance.elements?.paywallCard)}
    >
      <CardHeader>
        {/* Display face at the SAME size. The compact soft wall re-sizes this exact
            slot from a container query in kaiten.css and measures the lock beside it;
            changing the face is inert there, changing the box is not. */}
        <CardTitle className="flex items-center gap-2 text-base font-bold">
          <LockIcon className="size-5 shrink-0 text-muted-foreground" />
          {title}
          {trigger.reason === "error" || !trigger.metered ? null : (
            <Badge shape="pill" variant={badgeVariant} className="ktn-paywall-usage-badge ml-auto">
              {Math.round(trigger.percentage)}%
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {trigger.metered ? (
            <ProgressBar
              value={trigger.current}
              max={trigger.limit}
              className={cn(appearance.elements?.usageBar)}
              fillClassName={cn(appearance.elements?.usageBarFill)}
            />
          ) : null}
          {/*
            A wall at 100% is two different situations wearing the same number: a
            lifetime counter is full until someone buys more, a periodic one
            empties on its own at the end of the window. Without the window the
            reader cannot tell which, and the CTA is the only thing left to
            believe — which is wrong half the time.
          */}
          {trigger.metered && trigger.usageWindow ? (
            <p className="ktn-paywall-usage-window text-xs text-ktn-muted-foreground">
              {trigger.usageWindow}
            </p>
          ) : null}
          {descriptionNode}
        </div>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-6">
        <div className="flex w-full gap-2">
          {onUpgrade ? (
            <Button
              onClick={() => onUpgrade(trigger.recommendedAction)}
              /* The design gives the wall's way out the brand gradient. Background
                 only, so the compact wall's width arithmetic is untouched. */
              className="ktn-cta-gradient flex-1"
            >
              {ctaLabel(trigger.recommendedAction, localization)}
              <ArrowIcon className="size-4" />
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="outline" onClick={onDismiss}>
              {localization.paywall.dismiss}
            </Button>
          ) : null}
        </div>
        <KaitenBranding className="ktn-paywall-branding -mx-6 -mb-6" />
      </CardFooter>
    </Card>
  );
}

// The redundant `Paywall.Gate` declarative gate was removed — use `<Show>`
// for conditional rendering, or `usePaywallTrigger` for the raw decision. `Paywall`
// is the overlay/upsell component.
export const Paywall = PaywallRoot;
