// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useCancelSubscription, usePaymentMethodSession } from "@kaitencloud/react/billing";
import {
  BoundaryPendingError,
  KaitenError,
  ProviderUnavailableError,
  formatKaitenPrice,
  useLocalization,
  usePortal,
  type PortalTrial,
} from "@kaitencloud/react";
import { useTrackComponent } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { Action, Message } from "../shared/feedback.tsx";
import { useFocusScope } from "../shared/focus.ts";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { describePaymentMethod } from "../shared/payment-method-label.ts";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { remainingOf, useTrialNow, type TrialNow } from "./trial-countdown.ts";
import { useTrialBannerWords } from "./words.ts";

export interface TrialBannerProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /**
   * The trial to show. Default: the portal's own `trial` block, read from the customer session.
   * Pass one to draw a trial the host holds, or `null` to draw nothing; its "Add a card" and
   * "Cancel" still act on the session, and the portal is read again after either.
   */
  trial?: PortalTrial | null;
  /**
   * The instant the countdown counts from. Default: the clock, read again every half minute. A
   * fixed instant stops it: for a server render, a story, a test.
   */
  now?: TrialNow;
  /**
   * Where the provider's page sends the customer back to, with `kaiten_setup_session` appended: an
   * origin the publishable keys allow. Default: this page, minus its fragment and any `kaiten_*`
   * parameter. Mount the banner on that page: the card is confirmed from there.
   */
  returnUrl?: string;
  /** What sends the page to the provider's. Default `location.assign`. */
  navigate?: (url: string) => void;
  /** Called once the customer ended their trial, after the portal was read again. */
  onTrialEnded?: () => void;
}

/**
 * The trial a customer session's instance is in: a countdown to its end, what the end will charge
 * and when, the card it goes to or a prompt to add one, and the two things a customer can do about
 * it, "Add a card" and "Cancel". It draws nothing outside a trial.
 *
 * The amount is the server's, as the portal gives it, never computed here; when the end of the
 * trial charges nothing the banner says so. "Add a card" sends the customer to the provider's page
 * in place of this one and back, and on their return the banner confirms with the API that a card
 * was saved and shows it. "Cancel" asks first, and says that the trial ends at once with nothing
 * charged. The portal says whether either is offered (`capabilities.paymentMethods`,
 * `capabilities.unsubscribe`). It adds no route and reads nothing but the portal.
 *
 * Needs `mode="customer-session"` and the first Kaiten release that serves the portal's trial block.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function TrialBanner({
  appearance,
  unstyled = false,
  trial: given,
  now: fixedNow,
  returnUrl,
  navigate,
  onTrialEnded,
}: TrialBannerProps) {
  useAssertWrappedByKaitenProvider("TrialBanner");
  useTrackComponent("TrialBanner");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const words = useTrialBannerWords();
  const localization = useLocalization();
  const portal = usePortal();
  const now = useTrialNow(fixedNow);
  const scope = useFocusScope();
  const card = usePaymentMethodSession({ opening: "redirect", returnUrl, navigate });
  const cancel = useCancelSubscription();
  const [confirming, setConfirming] = React.useState(false);
  const [failure, setFailure] = React.useState<string | null>(null);

  const trial = given !== undefined ? given : (portal.data?.trial ?? null);
  if (!trial) return null;

  const capabilities = portal.data?.capabilities;
  const canAddCard = trial.paymentMethod === null && capabilities?.paymentMethods === true;
  const canCancel = capabilities?.unsubscribe === true;

  const left = remainingOf(trial.endsAt, now);
  const countdown =
    left.unit === "days"
      ? words.endsInDays(left.count)
      : left.unit === "hours"
        ? words.endsInHours(left.count)
        : left.unit === "minutes"
          ? words.endsInMinutes(left.count)
          : words.endsInAMoment;

  const { charge } = trial;
  const price = charge
    ? formatKaitenPrice(
        {
          amount: charge.amount,
          currencyCode: charge.currencyCode,
          billingModel: "FLAT_FEE",
          interval: charge.billingInterval,
          ...(charge.intervalCount ? { intervalCount: charge.intervalCount } : {}),
        },
        localization,
      )
    : null;
  // The server's figure is what the sentence says; without a price that can be written, it says none.
  const chargeLine =
    charge === null
      ? words.nothingCharged
      : price !== null
        ? words.chargeOn(price, trial.endsAt)
        : null;
  const cardLine = trial.paymentMethod
    ? words.cardOnFile(
        describePaymentMethod(
          {
            status: "ACTIVE",
            brand: trial.paymentMethod.brand,
            last4: trial.paymentMethod.last4,
            expMonth: null,
            expYear: null,
          },
          words,
        ).label,
      )
    : words.noCard;

  const adding = card.status === "opening";
  const saving = card.status === "saving";
  const cancelling = cancel.isPending;
  const busy = adding || saving || cancelling;
  const waiting = cancel.retryAt !== null;

  const cardFailure =
    card.status !== "failed"
      ? null
      : card.error instanceof KaitenError && card.error.code?.endsWith(".SessionNotComplete")
        ? words.incomplete
        : card.error instanceof ProviderUnavailableError
          ? words.unavailable
          : words.error;

  const endTrial = async () => {
    setFailure(null);
    try {
      await cancel.mutateAsync();
      setConfirming(false);
      onTrialEnded?.();
    } catch (error) {
      setFailure(
        error instanceof BoundaryPendingError
          ? words.stillClosing
          : error instanceof ProviderUnavailableError
            ? words.unavailable
            : words.error,
      );
    }
  };

  const feedback = (
    <div
      data-slot="trial-banner-feedback"
      className={cn("ktn-own", !unstyled && "flex flex-col gap-3")}
    >
      {saving ? <Message unstyled={unstyled} tone="muted" text={words.saving} busy /> : null}
      {card.status === "saved" ? (
        <Message unstyled={unstyled} tone="success" text={words.saved} />
      ) : null}
      {cardFailure ? <Message unstyled={unstyled} tone="error" text={cardFailure} /> : null}
      {waiting ? <Message unstyled={unstyled} tone="info" text={words.stillClosing} busy /> : null}
      {failure ? <Message unstyled={unstyled} tone="error" text={failure} /> : null}
    </div>
  );

  const actions =
    canAddCard || canCancel ? (
      confirming ? (
        <div
          role="group"
          aria-label={words.cancel}
          className={
            unstyled ? undefined : "ktn-own flex flex-col gap-3 rounded-lg border bg-card p-3"
          }
        >
          <p
            data-focus="cancel-prompt"
            tabIndex={-1}
            className={unstyled ? undefined : "ktn-own text-sm"}
          >
            {words.cancelPrompt}
          </p>
          <div className={unstyled ? undefined : "ktn-own flex flex-wrap gap-2"}>
            <Action
              unstyled={unstyled}
              variant="destructive"
              size="sm"
              busy={busy}
              onClick={() => void endTrial()}
            >
              {words.cancelConfirm}
            </Action>
            <Action
              unstyled={unstyled}
              variant="outline"
              size="sm"
              busy={busy}
              onClick={() => {
                setConfirming(false);
                scope.focus("cancel-trigger");
              }}
            >
              {words.cancelKeep}
            </Action>
          </div>
        </div>
      ) : (
        <div className={unstyled ? undefined : "ktn-own flex flex-wrap gap-2"}>
          {canAddCard ? (
            <Action
              unstyled={unstyled}
              variant="default"
              size="sm"
              busy={busy}
              focusKey="add-card"
              onClick={() => void card.start()}
            >
              {adding ? words.opening : words.addCard}
            </Action>
          ) : null}
          {canCancel ? (
            <Action
              unstyled={unstyled}
              variant="outline"
              size="sm"
              busy={busy}
              focusKey="cancel-trigger"
              onClick={() => {
                setFailure(null);
                setConfirming(true);
                scope.focus("cancel-prompt");
              }}
            >
              {words.cancel}
            </Action>
          ) : null}
        </div>
      )
    ) : null;

  if (unstyled) {
    return (
      <section
        ref={scope.ref}
        data-slot="trial-banner"
        aria-label={words.title}
        className="ktn-own"
      >
        <h3 data-slot="trial-banner-countdown" className="ktn-own" suppressHydrationWarning>
          {countdown}
        </h3>
        <p data-slot="trial-banner-ends-on" className="ktn-own">
          {words.endsOn(trial.endsAt)}
        </p>
        {chargeLine ? (
          <p data-slot="trial-banner-charge" className="ktn-own">
            {chargeLine}
          </p>
        ) : null}
        <p data-slot="trial-banner-card" className="ktn-own">
          {cardLine}
        </p>
        {actions}
        {feedback}
      </section>
    );
  }

  const CardIcon = icons.creditCard;

  return (
    <div
      ref={scope.ref}
      role="region"
      aria-label={words.title}
      data-slot="trial-banner"
      className="ktn-own"
    >
      <Card className={cn(merged.elements?.card)}>
        <CardHeader className={cn(merged.elements?.cardHeader)}>
          <CardTitle className={cn(merged.elements?.cardTitle)}>
            <span data-slot="trial-banner-countdown" className="ktn-own" suppressHydrationWarning>
              {countdown}
            </span>
          </CardTitle>
          <p data-slot="trial-banner-ends-on" className="ktn-own text-sm text-ktn-muted-foreground">
            {words.endsOn(trial.endsAt)}
          </p>
        </CardHeader>
        <CardContent className={cn("flex flex-col gap-4", merged.elements?.cardContent)}>
          <div className="ktn-own flex flex-col gap-2 text-sm">
            {chargeLine ? (
              <p data-slot="trial-banner-charge" className="ktn-own">
                {chargeLine}
              </p>
            ) : null}
            <p data-slot="trial-banner-card" className="ktn-own flex items-center gap-2">
              <CardIcon className="size-4 shrink-0 text-ktn-primary" />
              <span>{cardLine}</span>
            </p>
          </div>
          {actions}
          {feedback}
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    </div>
  );
}
