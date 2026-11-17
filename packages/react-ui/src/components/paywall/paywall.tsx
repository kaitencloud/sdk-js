// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { flushSync } from "react-dom";

import {
  useEntitlements,
  usePaywallTrigger,
  useLocalization,
  type PortalAction,
} from "@kaitencloud/react";
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
import { useSubscriptionWords } from "../shared/billing-words.ts";
import { describeSubscription, useSubscriptionState } from "../shared/subscription-state.ts";
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
 * The wrappers with no wall up: there, but out of the layout.
 *
 * The content sits in the same two elements whether a wall is up or not, so that a wall
 * coming up or down only toggles `inert` on them. Rendering `children` bare when no wall
 * was up changed the shape of the tree, and React unmounted and remounted the content
 * each time: a form being filled when a periodic read crossed the threshold came back
 * empty. With no wall, `display: contents` keeps the two elements out of the host's
 * layout, as the bare `children` were. It is a style rather than a class, so that it
 * holds with or without the SDK's stylesheet.
 */
const CONTENTS: React.CSSProperties = { display: "contents" };

/** The first control of the wall, which takes the focus the wall takes from the content. */
const FOCUSABLE = 'button, [href], input, [tabindex]:not([tabindex="-1"])';

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/**
 * The refusals hard mode shows as a modal: they name what the customer lacks, and what
 * to buy. Any other reason, a later one included, comes up as the inline wall.
 */
function isModalRefusal(reason: string | null): boolean {
  return reason === "over_limit" || reason === "insufficient_quota" || reason === "not_entitled";
}

/**
 * Why the wall says WHY it is there, in the DOM.
 *
 * `data-slot="paywall"` told a host that a wall is up and nothing else, so the
 * two questions a host actually asks — is this a quota that ran out, or a
 * feature the plan never included? is this an outage? — had no answer short of
 * duplicating `usePaywallTrigger` beside the component that already computed it.
 * `data-reason` carries `usePaywallTrigger`'s own verdict:
 *
 *   over_limit | insufficient_quota | near_limit | not_entitled | usage_unavailable | error
 *
 * and, because the set is open, whatever reason a later Kaiten billing adds: a
 * reason this component does not know comes up as a wall with the generic wording,
 * the content behind it inert, and `hard` mode shows it as the inline wall, not the
 * dialog, which is kept for the three refusals that name what the customer lacks.
 *
 * It is on every branch that renders a wall, the hard mode's `<dialog>`
 * included, and on the same element as `data-slot`. Analytics can segment on it,
 * CSS can style on it (`[data-reason="error"]`), and an E2E test can assert the
 * cause rather than the symptom. `error` is the one worth naming: it means
 * there is no entitlement data to decide on, so the wall is the fail-closed
 * policy talking, not a decision about this customer.
 */

function ctaLabel(
  action: PortalAction | undefined,
  localization: ReturnType<typeof useLocalization>,
  /** What a customer who can buy a plan by themselves is offered in place of "Upgrade". */
  subscribe: string | null,
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
      return subscribe ?? localization.paywall.upgrade;
  }
}

export interface PaywallProps {
  entitlement: string;
  threshold?: number;
  /** Minimum remaining numeric units required before the wrapped content unlocks. */
  min?: number;
  mode?: "soft" | "hard";
  /**
   * Fail policy when there is no access data to decide on: no read ever
   * succeeded, or reads have been failing for longer than the provider's
   * `staleIfErrorMs`. `"block"` (default, fail-closed) shows the paywall, so
   * paid content is never revealed to a customer nothing was read for;
   * `"allow"` (fail-open) reveals the wrapped content. A read that fails after
   * one that succeeded is not that case: the wall is decided on the data that
   * read left.
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
  const trigger = usePaywallTrigger(entitlement, { threshold, min, onError });
  // The trigger gates on its own, older rule and says nothing of the allowance, which the bar needs
  // to draw the track the grant actually permits.
  const entitlements = useEntitlements();
  const overagePercent = entitlements.data?.find(
    (candidate) => candidate.slug === entitlement,
  )?.limitCapExceededOveragePercent;
  const icons = useIcons();
  const localization = useLocalization();
  const subscriptionWords = useSubscriptionWords();
  const subscriptionState = useSubscriptionState();
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
    if (mode === "hard" && isModalRefusal(trigger.reason) && trigger.shouldShow && !onUpgrade) {
      console.warn(
        '[@kaitencloud/react] Paywall: `mode="hard"` with no `onUpgrade` leaves users without an upgrade action. Provide `onUpgrade` or `onDismiss`.',
      );
    }
  }, [mode, onUpgrade, trigger.reason, trigger.shouldShow]);

  // `hard` keeps a REFUSAL behind the wall. The warning before the limit is no refusal —
  // the usage is still accepted — so it can be closed in both modes.
  const dismissible = mode === "soft" || trigger.reason === "near_limit";
  const wallUp = !trigger.isLoading && trigger.shouldShow && !(dismissed && dismissible);
  const modal =
    wallUp && !unstyled && mode === "hard" && !modalDismissed && isModalRefusal(trigger.reason);
  const inlineWall = wallUp && !modal;

  // The content underneath an inline wall is `inert`, so a focus inside it would be lost
  // to the page: the wall takes it, and gives it back when it comes down. A focus
  // anywhere else stays where it is — a periodic read that crosses the threshold must
  // not pull the reader out of whatever they are doing elsewhere on the page. The
  // dialog holds focus itself.
  //
  // A layout effect, so that the focus is read before the browser moves it off the
  // content that just became inert. Both moves pass `preventScroll`: plain `focus()`
  // scrolls every scrollable ancestor to its target, and the focus move is the point,
  // not the scroll.
  const contentRef = React.useRef<HTMLDivElement>(null);
  const overlayRef = React.useRef<HTMLDivElement>(null);
  useIsomorphicLayoutEffect(() => {
    if (!inlineWall) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !contentRef.current?.contains(focused)) return;
    overlayRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    return () => {
      // Only a focus the wall still holds goes back: one the reader moved elsewhere stays.
      const now = document.activeElement;
      if (now === null || now === document.body || overlayRef.current?.contains(now)) {
        focused.focus({ preventScroll: true });
      }
    };
  }, [inlineWall]);

  // Access is not known yet. Rendering `children` here revealed the protected
  // content on every first mount — and on every remount, which the provider does
  // whenever its scope key changes — contradicting the fail-closed policy this
  // component documents on `onError`. `Show` already hides during loading and
  // takes a `loading` slot; `Gate` deliberately stays open because the host sees
  // `isLoading` and the server still enforces. Paywall can do neither: it renders
  // the protected content itself, so it follows `onError`.
  if (trigger.isLoading && onError !== "allow") {
    return <>{loading}</>;
  }

  const LockIconComp = icons.lock;
  const ArrowIcon = icons.arrowRight;

  const reasonLabel =
    trigger.reason === "over_limit"
      ? localization.paywall.limitReached
      : trigger.reason === "insufficient_quota"
        ? localization.paywall.insufficientQuota
        : trigger.reason === "near_limit"
          ? localization.paywall.approachingLimit
          : trigger.reason === "usage_unavailable"
            ? localization.paywall.usageUnavailable
            : localization.paywall.notAvailable;

  const badgeVariant =
    trigger.reason === "over_limit" ||
    trigger.reason === "insufficient_quota" ||
    trigger.reason === "error"
      ? "destructive"
      : "secondary";

  // A figure only where there is one: an unread usage is not zero, and a feature the
  // plan does not include is not "0 of 1".
  const description =
    trigger.reason === "error"
      ? localization.paywall.errorDescription
      : trigger.reason === "usage_unavailable"
        ? localization.paywall.usageUnavailableDescription
        : trigger.reason === "insufficient_quota" &&
            typeof min === "number" &&
            typeof trigger.remaining === "number"
          ? localization.paywall.insufficientQuotaDescription(
              min.toLocaleString(),
              trigger.remaining.toLocaleString(),
            )
          : trigger.reason !== "not_entitled" && trigger.metered
            ? localization.paywall.usageDescription(
                trigger.current.toLocaleString(),
                trigger.limit.toLocaleString(),
              )
            : localization.paywall.flagDisabledDescription;

  // Under a customer session the portal also says where the subscription stands. That never opens
  // or closes a wall (billing status closes none), but it explains one: a subscription that is over,
  // a payment that failed, a plan bought that starts once its payment is confirmed, a cancellation
  // or a trial that runs out. And a customer who can buy a plan by themselves is offered to
  // subscribe, not to upgrade.
  const described = subscriptionState
    ? describeSubscription(subscriptionState, subscriptionWords, localization)
    : null;
  const note =
    subscriptionState?.kind === "past_due" ||
    subscriptionState?.kind === "canceled" ||
    subscriptionState?.kind === "incomplete"
      ? (described?.notice ?? null)
      : subscriptionState?.ending || subscriptionState?.kind === "trial"
        ? (described?.detail ?? null)
        : null;
  const subscribe = subscriptionState?.capabilities.checkout ? subscriptionWords.subscribe : null;
  const subscriptionKind = subscriptionState?.kind;

  // A usage nobody could read is no reason to sell anything.
  const upgrade = trigger.reason === "usage_unavailable" ? undefined : onUpgrade;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  // The modal is closed before the host's upgrade runs, so that whatever the host opens
  // from it — a checkout in its own modal — is not left under one it cannot reach. The
  // content stays behind the inline wall.
  const upgradeFromModal = upgrade
    ? (action?: PortalAction) => {
        flushSync(() => setModalDismissed(true));
        upgrade(action);
      }
    : undefined;

  let overlay: React.ReactNode = null;
  if (modal) {
    overlay =
      (
        /*
         * The wall blocks the FEATURE, not the browser.
         *
         * This dialog used to be a Radix `<Dialog open>` with no `onOpenChange`,
         * no close button, and Escape, outside-click and pointer-down-outside all
         * prevented. A modal traps focus, so with `onUpgrade` absent the card
         * rendered no button at all and a keyboard user had no way out of the
         * dialog OR back to the page — a WCAG 2.1.2 keyboard trap whose only
         * mitigation was a dev-mode console.warn.
         *
         * Closing it costs the gate nothing: `children` stay `inert`, and dismissing
         * the modal falls through to the inline wall, which keeps them inert and
         * renders no dismiss control for a refusal in hard mode. The paid content stays
         * unreachable; the page stops being a cage.
         *
         * It is the native `<dialog>` now (see ui/dialog.tsx): a click on the
         * backdrop does nothing there by default, so a stray click cannot drop
         * the modal by accident — Escape and the close button are the deliberate
         * exits.
         */
        <Dialog
          data-reason={trigger.reason ?? undefined}
          data-subscription={subscriptionKind}
          onDismiss={() => setModalDismissed(true)}
        >
          <PaywallCard
            reasonLabel={reasonLabel}
            description={description}
            badgeVariant={badgeVariant}
            trigger={trigger}
            overagePercent={overagePercent}
            onUpgrade={upgradeFromModal}
            appearance={merged}
            LockIcon={LockIconComp}
            ArrowIcon={ArrowIcon}
            dialog
            localization={localization}
            note={note}
            subscribe={subscribe}
          />
        </Dialog>
      );
  } else if (inlineWall && unstyled) {
    overlay = (
      <div ref={overlayRef} role="group" aria-label={reasonLabel}>
        <p>{reasonLabel}</p>
        <p>{description}</p>
        {note ? <p>{note}</p> : null}
        {trigger.metered ? (
          <p>
            {trigger.current} / {trigger.limit}
          </p>
        ) : null}
        {upgrade ? (
          <button type="button" onClick={() => upgrade(trigger.recommendedAction)}>
            {ctaLabel(trigger.recommendedAction, localization, subscribe)}
          </button>
        ) : null}
        {dismissible ? (
          <button type="button" onClick={handleDismiss}>
            {localization.paywall.dismiss}
          </button>
        ) : null}
        <KaitenBranding unstyled />
      </div>
    );
  } else if (inlineWall) {
    overlay = (
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
            overagePercent={overagePercent}
            onUpgrade={upgrade}
            onDismiss={dismissible ? handleDismiss : undefined}
            appearance={merged}
            LockIcon={LockIconComp}
            ArrowIcon={ArrowIcon}
            localization={localization}
            note={note}
            subscribe={subscribe}
          />
        </div>
      </div>
    );
  }

  return (
    /*
     * One shape whatever the wall does (see `CONTENTS`): the content is always the first
     * child of the second element, and a wall only toggles `inert` and the classes.
     *
     * The inline wall is an `absolute inset-0` overlay, so the box the card has to fit
     * into is whatever the host wrapped — and a host gates small things: a button, a
     * toolbar row, a stat. `min-h-20` is the floor the compact wall needs to sit in
     * (`.ktn-paywall-wall` in src/styles/kaiten.css turns the card into a single row
     * below the full card's footprint); without it a one-line child left the card
     * centred on a ~20px box, spilling over the components either side.
     *
     * It is the last class before `paywallOverlay`, so a host that would rather keep
     * its own layout can drop the floor with `min-h-0` and take the spill back.
     */
    <div
      data-slot={inlineWall ? "paywall" : undefined}
      data-reason={inlineWall ? (trigger.reason ?? undefined) : undefined}
      data-subscription={inlineWall ? subscriptionKind : undefined}
      className={
        inlineWall
          ? unstyled
            ? "ktn-own"
            : cn("ktn-own", "relative min-h-20", merged.elements?.paywallOverlay)
          : undefined
      }
      style={inlineWall ? undefined : CONTENTS}
    >
      {/* Masked content is inert: not focusable, not clickable, hidden from AT. */}
      <div
        ref={contentRef}
        {...(wallUp ? INERT : null)}
        className={HOST_SUBTREE}
        style={wallUp ? undefined : CONTENTS}
      >
        {children}
      </div>
      {overlay}
    </div>
  );
}

function PaywallCard({
  reasonLabel,
  description,
  badgeVariant,
  trigger,
  overagePercent,
  onUpgrade,
  onDismiss,
  appearance,
  LockIcon,
  ArrowIcon,
  localization,
  note,
  subscribe,
  dialog = false,
}: {
  reasonLabel: string;
  description: string;
  badgeVariant: "destructive" | "secondary";
  trigger: ReturnType<typeof usePaywallTrigger>;
  /** The allowance of the quota behind the wall, as a percentage of its limit. */
  overagePercent?: number | null;
  onUpgrade?: (action?: PortalAction) => void;
  onDismiss?: () => void;
  appearance: KaitenAppearance;
  LockIcon: React.ComponentType<{ className?: string }>;
  ArrowIcon: React.ComponentType<{ className?: string }>;
  localization: ReturnType<typeof useLocalization>;
  /** What the subscription behind the wall adds to its reason, when it is worth saying. */
  note: string | null;
  subscribe: string | null;
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
              overagePercent={overagePercent}
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
          {note ? (
            <p
              data-slot="paywall-subscription-note"
              className="ktn-own text-sm text-muted-foreground"
            >
              {note}
            </p>
          ) : null}
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
              {ctaLabel(trigger.recommendedAction, localization, subscribe)}
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
