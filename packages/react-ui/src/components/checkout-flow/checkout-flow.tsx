import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { cn } from "../../lib/utils.ts";
import { DEFAULT_CURRENCY_CODE, useLocalization, type CurrencyCode } from "@kaitencloud/react";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Separator } from "../ui/separator.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { useIcons } from "../../appearance/icons.tsx";

// ---------------------------------------------------------------------------
// This component is a shell around a total the host computes. With Kaiten billing
// the amount due is the server's: a checkout's `dryRun`
// (POST /public/session/checkout) answers what is due today, and the SDK never adds
// prices up. Until the component is rebuilt on that answer, it operates in
// "redirect" mode: the consumer provides an onCheckout callback that handles
// payment externally.
// ---------------------------------------------------------------------------

export interface CheckoutItem {
  slug: string;
  name: string;
  /** Price in the currency's minor units (integer), e.g. `7900` for $79.00. */
  price: number;
  /** ISO-4217 currency code (e.g. `"USD"`). Defaults to the plan's currency. */
  currencyCode?: CurrencyCode;
  interval?: "month" | "year";
  type: "plan" | "addon";
}

function checkoutIntervalSuffix(
  interval: CheckoutItem["interval"] | undefined,
  short: { month: string; year: string },
): string {
  return interval === "year" ? short.year : short.month;
}

export interface CheckoutSummaryProps {
  items: CheckoutItem[];
  /**
   * REQUIRED billing integration point — invoked when the user confirms the
   * selection. Kaiten ships no payment/checkout backend, so this component only
   * SUMMARIZES the selection and hands off: wire it to Stripe Checkout, Paddle,
   * Lemon Squeezy, or your own flow. It is required precisely so the confirm
   * button is never a dead end.
   */
  onCheckout: (items: CheckoutItem[]) => void | Promise<void>;
  onCancel?: () => void;
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export function CheckoutSummary({
  items,
  onCheckout,
  onCancel,
  appearance,
  unstyled = false,
}: CheckoutSummaryProps) {
  useAssertWrappedByKaitenProvider("CheckoutSummary");
  useTrackComponent("CheckoutSummary");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const localization = useLocalization();
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const plan = items.find((i) => i.type === "plan");
  const addons = items.filter((i) => i.type === "addon");
  const currencyCode = plan?.currencyCode ?? DEFAULT_CURRENCY_CODE;
  const total = items.reduce((sum, i) => sum + i.price, 0);
  const formatItemPrice = (item: CheckoutItem) =>
    localization.formatMoney(item.price, item.currencyCode ?? currencyCode);

  const handleCheckout = async () => {
    setErrorMessage(null);
    setIsProcessing(true);
    try {
      await onCheckout(items);
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message ? error.message : localization.checkoutFlow.error,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const LoaderIcon = icons.loader;
  const CheckIcon = icons.check;
  const PlusIcon = icons.plus;
  // Neutral "continue" affordance — NOT a credit-card icon. This component
  // summarizes a selection and hands off; it does not take payment.
  const ArrowIcon = icons.arrowRight;

  const intervalShort = {
    month: localization.checkoutFlow.intervalShortMonth,
    year: localization.checkoutFlow.intervalShortYear,
  };

  if (unstyled) {
    return (
      <section data-slot="checkout-summary" className="ktn-own">
        <h3>{localization.checkoutFlow.title}</h3>
        <p>{localization.checkoutFlow.description}</p>
        <ul>
          {items.map((item) => (
            <li key={`${item.type}:${item.slug}`}>
              {item.name} (
              {item.type === "plan"
                ? localization.checkoutFlow.plan
                : localization.checkoutFlow.addOn}
              ) - {formatItemPrice(item)}
              {checkoutIntervalSuffix(item.interval, intervalShort)}
            </li>
          ))}
        </ul>
        <p>
          {localization.checkoutFlow.total}: {localization.formatMoney(total, currencyCode)}
          {checkoutIntervalSuffix(plan?.interval, intervalShort)}
        </p>
        <div>
          <button type="button" onClick={() => void handleCheckout()} disabled={isProcessing}>
            {isProcessing
              ? localization.checkoutFlow.processing
              : localization.checkoutFlow.proceedToPayment}
          </button>
          {onCancel ? (
            <button type="button" onClick={onCancel} disabled={isProcessing}>
              {localization.checkoutFlow.cancel}
            </button>
          ) : null}
        </div>
        {errorMessage ? (
          <p
            data-slot="checkout-summary-error"
            className="ktn-own"
            role="alert"
            aria-live="assertive"
          >
            {errorMessage}
          </p>
        ) : null}
        <KaitenBranding unstyled />
      </section>
    );
  }

  // `w-[min(100%,32rem)]` already says "fill the slot, but never wider than 32rem".
  // A `sm:min-w-[28rem]` used to sit beside it, and being keyed to the WINDOW it fired
  // in any slot at all once the browser was 640px wide — imposing a 448px floor on a
  // 320px slot, for an overflow of exactly 128px. Dropping it costs nothing: the floor
  // could only ever bite in slots narrower than itself, which is where it did damage.
  return (
    <div data-slot="checkout-summary" className="ktn-own w-[min(100%,32rem)]">
      <Card className={cn(merged.elements?.card)}>
        <CardHeader>
          <CardTitle>{localization.checkoutFlow.title}</CardTitle>
          <CardDescription>{localization.checkoutFlow.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {plan && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckIcon className="size-4 text-ktn-success" />
                  <span className="text-sm font-medium">{plan.name}</span>
                  <Badge variant="secondary">{localization.checkoutFlow.plan}</Badge>
                </div>
                <span
                  className="text-sm font-mono"
                  aria-label={localization.checkoutFlow.priceLabel(
                    formatItemPrice(plan),
                    plan.interval,
                  )}
                >
                  {formatItemPrice(plan)}
                  {checkoutIntervalSuffix(plan.interval, intervalShort)}
                </span>
              </div>
            )}
            {addons.map((addon) => (
              <div key={addon.slug} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <PlusIcon className="size-4 text-ktn-success" />
                  <span className="text-sm">{addon.name}</span>
                  <Badge variant="outline">{localization.checkoutFlow.addOn}</Badge>
                </div>
                <span
                  className="text-sm font-mono"
                  aria-label={localization.checkoutFlow.priceLabel(
                    formatItemPrice(addon),
                    addon.interval,
                  )}
                >
                  {formatItemPrice(addon)}
                  {checkoutIntervalSuffix(addon.interval, intervalShort)}
                </span>
              </div>
            ))}
            <Separator className="my-2" />
            <div className="flex items-center justify-between font-medium">
              <span>{localization.checkoutFlow.total}</span>
              <span
                className="font-mono"
                aria-label={localization.checkoutFlow.priceLabel(
                  localization.formatMoney(total, currencyCode),
                  plan?.interval,
                )}
              >
                {localization.formatMoney(total, currencyCode)}
                {checkoutIntervalSuffix(plan?.interval, intervalShort)}
              </span>
            </div>
            {errorMessage ? (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-destructive-subtle-foreground/30 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground"
              >
                {errorMessage}
              </div>
            ) : null}
          </div>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4 p-0">
          <div className="flex gap-2 px-6">
            <Button
              onClick={() => void handleCheckout()}
              disabled={isProcessing}
              className="flex-1"
            >
              {isProcessing ? (
                <>
                  <LoaderIcon className="size-4" />
                  {localization.checkoutFlow.processing}
                </>
              ) : (
                <>
                  {localization.checkoutFlow.proceedToPayment}
                  <ArrowIcon className="size-4" />
                </>
              )}
            </Button>
            {onCancel && (
              <Button variant="outline" onClick={onCancel} disabled={isProcessing}>
                {localization.checkoutFlow.cancel}
              </Button>
            )}
          </div>
          <KaitenBranding className="-mb-6" />
        </CardFooter>
      </Card>
    </div>
  );
}
