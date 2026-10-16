import * as React from "react";

import { useBillingPortal, usePaymentMethodSession } from "@kaitencloud/react/billing";
import {
  KaitenError,
  ProviderUnavailableError,
  useLocalization,
  usePortal,
  type KaitenPaymentMethodWords,
  type PaymentMethodSummary,
} from "@kaitencloud/react";
import { useKaitenDataContext, useTrackComponent } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { usePaymentMethodWords } from "../shared/billing-words.ts";
import { Action, Message } from "../shared/feedback.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

/** What the payment providers call their card brands, written as a customer knows them. */
const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

/**
 * A payment method as its labels say it: "Visa •••• 4242", and "12/2030" when the provider gave
 * an expiry. The provider gives what it knows, and a label it does not give is left out rather
 * than made up. Never a number: the API does not carry one.
 */
export function describePaymentMethod(
  paymentMethod: PaymentMethodSummary,
  words: Pick<KaitenPaymentMethodWords, "card">,
): { label: string; expiry: string | null } {
  const brand =
    paymentMethod.brand && paymentMethod.brand !== "unknown"
      ? (BRANDS[paymentMethod.brand] ??
        paymentMethod.brand.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()))
      : words.card;
  const label = paymentMethod.last4 ? `${brand} •••• ${paymentMethod.last4}` : brand;
  const expiry =
    paymentMethod.expMonth !== null && paymentMethod.expYear !== null
      ? `${String(paymentMethod.expMonth).padStart(2, "0")}/${paymentMethod.expYear}`
      : null;
  return { label, expiry };
}

export interface PaymentMethodCardProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /**
   * The currency to set a payment method up in, for a customer with no live subscription: the
   * provider keeps one currency per customer, so it is asked for. Default: the currency of their
   * last subscription, else the catalogue's when it sells in one. Ignored while a subscription
   * is live, whose currency it is.
   */
  currencyCode?: string;
  /**
   * Where the provider's page sends the customer back to, with `kaiten_setup_session` appended:
   * an origin the publishable keys allow. Default: this page, minus its fragment and any `kaiten_*`
   * parameter. Mount the card on that page: the payment method is confirmed from there.
   */
  returnUrl?: string;
  /** What sends the page to the provider's. Default `location.assign`. */
  navigate?: (url: string) => void;
}

/**
 * The payment method a customer session's invoices are charged to, with what they can do about
 * it: add one, replace it on the provider's hosted page, and manage it in the provider's own
 * billing portal. Needs `mode="customer-session"`. It is not there at all (no element, no empty
 * card) when the portal says the provider cannot capture one, as with an organization billed
 * outside any provider.
 *
 * The card says the labels the provider gave, never a number. Adding or replacing sends the
 * customer to the provider's page in place of this one and back: on their return the card
 * confirms with the API that a payment method was saved, reads the portal again and shows the new
 * labels. A confirmation that did not go through is said, with a way to try it again.
 *
 * Needs the first Kaiten release with billing.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function PaymentMethodCard({
  appearance,
  unstyled = false,
  currencyCode,
  returnUrl,
  navigate,
}: PaymentMethodCardProps) {
  useAssertWrappedByKaitenProvider("PaymentMethodCard");
  useTrackComponent("PaymentMethodCard");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const words = usePaymentMethodWords();
  const localization = useLocalization();
  const portal = usePortal();
  const catalog = useKaitenDataContext().catalog.data;

  const data = portal.data;
  const subscription = data?.subscription ?? null;
  const live = subscription !== null && subscription.status !== "CANCELED";
  // Which currency a payment method is set up in is the provider's to keep for good, so it is
  // never guessed: the live subscription's, the host's, the last subscription's, or the one a
  // catalogue sells in. When there is none the API refuses, and the customer is told.
  const catalogCurrencies = new Set(
    catalog?.plans.map((plan) => plan.currencyCode).filter(Boolean),
  );
  const currency = live
    ? undefined
    : (currencyCode ??
      subscription?.currencyCode ??
      (catalogCurrencies.size === 1 ? [...catalogCurrencies][0] : undefined));

  const method = usePaymentMethodSession({
    opening: "redirect",
    currencyCode: currency,
    returnUrl,
    navigate,
  });
  const providerPortal = useBillingPortal({ navigate });
  const [portalFailed, setPortalFailed] = React.useState(false);

  if (portal.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)} aria-busy="true">
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }
  if (portal.error && !data) {
    return <SectionError onRetry={portal.refetch} appearance={merged} unstyled={unstyled} />;
  }
  // A provider that cannot capture a payment method has none to show: the card is not there.
  if (!data || !data.capabilities.paymentMethods) return null;

  const paymentMethod = data.paymentMethod;
  const described = paymentMethod ? describePaymentMethod(paymentMethod, words) : null;
  const status = paymentMethod?.status;
  const trouble = status === "EXPIRED" || status === "FAILED";
  const needsAttention = !paymentMethod || trouble;

  const starting = method.status === "opening";
  const saving = method.status === "saving";
  const busy = starting || saving;
  const failedToConfirm =
    method.status === "failed" &&
    method.error instanceof KaitenError &&
    method.error.code?.endsWith(".SessionNotComplete");

  const failure =
    method.status !== "failed"
      ? null
      : failedToConfirm
        ? words.incomplete
        : method.error instanceof ProviderUnavailableError
          ? words.unavailable
          : words.error;

  const openProviderPortal = () => {
    setPortalFailed(false);
    providerPortal.open().catch(() => setPortalFailed(true));
  };

  const feedback = (
    <div data-slot="payment-method-feedback" className="ktn-own flex flex-col gap-3">
      {saving ? <Message unstyled={unstyled} tone="muted" text={words.saving} busy /> : null}
      {method.status === "saved" ? (
        <Message unstyled={unstyled} tone="success" text={words.saved} />
      ) : null}
      {failure ? <Message unstyled={unstyled} tone="error" text={failure} /> : null}
      {portalFailed ? <Message unstyled={unstyled} tone="error" text={words.error} /> : null}
    </div>
  );

  const actions = (
    <div className={unstyled ? undefined : "ktn-own flex flex-wrap gap-2"}>
      <Action
        unstyled={unstyled}
        variant={needsAttention ? "default" : "outline"}
        size="sm"
        disabled={busy}
        onClick={() => void method.start()}
      >
        {starting ? words.opening : paymentMethod ? words.update : words.add}
      </Action>
      {failedToConfirm ? (
        <Action
          unstyled={unstyled}
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void method.complete()}
        >
          {/* Checking again is a retry of the same thing: the page may have been finished since. */}
          {localization.states.retry}
        </Action>
      ) : null}
      {paymentMethod ? (
        <Action
          unstyled={unstyled}
          variant="outline"
          size="sm"
          disabled={providerPortal.isPending}
          onClick={openProviderPortal}
        >
          {words.manage}
        </Action>
      ) : null}
    </div>
  );

  if (unstyled) {
    return (
      <section data-slot="payment-method-card" className="ktn-own">
        <h3>{words.title}</h3>
        {described ? (
          <>
            <p data-slot="payment-method-label" className="ktn-own">
              {described.label}
            </p>
            {described.expiry ? <p>{words.expires(described.expiry)}</p> : null}
            {status === "EXPIRED" ? <p role="status">{words.expired}</p> : null}
            {status === "FAILED" ? <p role="status">{words.failed}</p> : null}
            {trouble ? (
              <p>{status === "EXPIRED" ? words.expiredNotice : words.failedNotice}</p>
            ) : null}
          </>
        ) : (
          <p>{words.none}</p>
        )}
        {actions}
        {feedback}
      </section>
    );
  }

  const CardIcon = icons.creditCard;

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn("flex items-center gap-2", merged.elements?.cardTitle)}>
          <CardIcon className="size-4 text-ktn-primary" />
          {words.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-4", merged.elements?.cardContent)}>
        {described ? (
          <div className="ktn-own flex flex-col gap-3">
            <div className="ktn-own flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="ktn-own flex min-w-0 flex-col gap-1">
                <p data-slot="payment-method-label" className="ktn-own font-medium break-words">
                  {described.label}
                </p>
                {described.expiry ? (
                  <p className="ktn-own text-xs text-ktn-muted-foreground">
                    {words.expires(described.expiry)}
                  </p>
                ) : null}
              </div>
              {trouble ? (
                <Badge variant="destructive">
                  {status === "EXPIRED" ? words.expired : words.failed}
                </Badge>
              ) : null}
            </div>
            {trouble ? (
              <p
                role="status"
                className="ktn-own rounded-ktn-lg border border-ktn-border bg-ktn-secondary/40 p-3 text-sm"
              >
                {status === "EXPIRED" ? words.expiredNotice : words.failedNotice}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="ktn-own text-sm text-ktn-muted-foreground">{words.none}</p>
        )}
        {actions}
        {feedback}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
