import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { useIcons } from "../../appearance/icons.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import {
  useEntitlements,
  useLicense,
  useLicensingSnapshot,
  usePortal,
  isCustomerFacing,
  formatKaitenPrice,
  useLocalization,
  DEFAULT_CURRENCY_CODE,
  type BillingInterval,
  type CurrencyCode,
  type ResolvedEntitlement,
} from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Button } from "../ui/button.tsx";
import { Separator } from "../ui/separator.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { describePaymentMethod } from "../payment-method-card/payment-method-card.tsx";
import { usePaymentMethodWords, useSubscriptionWords } from "../shared/billing-words.ts";
import {
  describeSubscription,
  useSubscriptionState,
  type SubscriptionDescription,
} from "../shared/subscription-state.ts";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { ProgressBar } from "../shared/progress-bar.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { isUnlimited } from "../shared/unlimited.tsx";
import {
  isUsageAtRisk,
  readQuota,
  type QuotaReading,
  type UsageState,
} from "../shared/usage-state.ts";

/**
 * How urgent each at-risk state is, for choosing the one sentence the panel can afford. Past the
 * ceiling first, then on it, then inside the allowance, then merely close.
 */
const SEVERITY: Partial<Record<UsageState, number>> = {
  over_limit: 4,
  at_limit: 3,
  in_allowance: 2,
  near_limit: 1,
};

/** A quota the summary shows, with where it stands read once. */
interface Meter {
  entitlement: ResolvedEntitlement;
  reading: QuotaReading;
}

/**
 * What the host tells the summary about money, where the licensing API does not know it.
 *
 * Under `mode="authenticated"` a licence carries no price, and there is no invoice or payment
 * method anywhere in what the snapshot reads, so these fields are the host's and have NO fallback
 * to the snapshot, deliberately. Under `mode="customer-session"` the portal says the price of the
 * subscription and the labels of the payment method itself, and the summary shows them for whatever
 * the host left out here; what the host supplies wins over the portal.
 *
 * Anything absent is not rendered at all. That is the whole point: a price wired to a source that
 * always returns nothing would render an empty slot indistinguishable from a customer who
 * genuinely has no price, and it would do it silently.
 */
export interface BillingSummaryBilling {
  /** Amount in the currency's MINOR units (integer) — `29900` is $299.00. */
  amount?: number;
  currencyCode?: CurrencyCode;
  interval?: BillingInterval;
  /** Free text, e.g. "Visa ending in 4242". The SDK never sees card data. */
  paymentMethodLabel?: string;
  onManageBilling?: () => void;
  /** Omit and the invoices link does not render — there is no invoice API yet. */
  onViewInvoices?: () => void;
}

function meteredEntitlements(entitlements: ResolvedEntitlement[]): ResolvedEntitlement[] {
  // The same filter `UsageMeters` and `EntitlementStatusBar` use: a meter needs a
  // finite numeric cap, and internal counters are not the customer's business.
  return entitlements.filter(
    (entitlement) =>
      isCustomerFacing(entitlement) &&
      entitlement.limitValue.type === "number" &&
      !(entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value)),
  );
}

/**
 * The sentence for the quota the panel is about. Near the limit it says how near with the figure its
 * row shows, the share of the granted value, so the panel and the row never quote two numbers for
 * one quota. On a soft limit the state is decided on the ceiling, and the hatched band past the grant
 * shows the room still left.
 */
function quotaSentence(
  { entitlement, reading, state }: Meter & { state: UsageState },
  localization: ReturnType<typeof useLocalization>,
): string {
  switch (state) {
    case "over_limit":
      return localization.billingSummary.quotaOverLimit(entitlement.name);
    case "at_limit":
      return localization.billingSummary.quotaAtLimit(entitlement.name);
    case "in_allowance":
      return localization.billingSummary.quotaInAllowance(entitlement.name);
    default:
      return localization.billingSummary.quotaWarning(entitlement.name, reading.percentOfGrant);
  }
}

export interface BillingSummaryProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  headerText?: string;
  subheaderText?: string;
  /** Editorial line in the footer, beside the upgrade action. Host-supplied. */
  footerText?: string;
  /** Money, payment method and invoices — see {@link BillingSummaryBilling}. */
  billing?: BillingSummaryBilling;
  /** Renders the footer's upgrade action when supplied. */
  onUpgrade?: () => void;
  upgradeText?: string;
  /** Cap on the meters shown. The rest stay in `UsageMeters`. */
  maxMeters?: number;
}

/**
 * Subscription state and current-cycle quotas in one panel.
 *
 * Deliberately NOT a replacement for `CustomerPortal`, which is the full
 * self-service surface (plan, included features, usage, add-ons, flags) laid out as
 * a grid of sections. This is the at-a-glance summary: one card, two columns, meant
 * to sit inside someone else's dashboard.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md);
 * prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function BillingSummary({
  appearance,
  unstyled = false,
  headerText,
  subheaderText,
  footerText,
  billing,
  onUpgrade,
  upgradeText,
  maxMeters = 4,
}: BillingSummaryProps) {
  useAssertWrappedByKaitenProvider("BillingSummary");
  useTrackComponent("BillingSummary");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const localization = useLocalization();
  const snapshot = useLicensingSnapshot();
  const license = useLicense();
  const entitlements = useEntitlements();
  const subscriptionWords = useSubscriptionWords();
  const paymentWords = usePaymentMethodWords();
  const portal = usePortal().data;

  // Under a customer session the subscription is what the portal says it is, and the licence's
  // term is not consulted at all: billing never moves a licence's end date, so a summary that read
  // it would say a subscription that renewed had ended. Under any other mode the term is all there
  // is, and it is information as it always was.
  const sessionState = useSubscriptionState();
  const described: SubscriptionDescription | null = sessionState
    ? describeSubscription(sessionState, subscriptionWords, localization)
    : null;
  const term = sessionState ? null : (snapshot.data?.licenseTerm ?? null);
  // A customer session has no licence: its portal names the plan.
  const planName = license.data?.name ?? snapshot.data?.currentPlan?.name ?? null;

  const meters = React.useMemo(
    (): Meter[] =>
      meteredEntitlements(entitlements.data ?? [])
        .slice(0, maxMeters)
        .map((entitlement) => ({ entitlement, reading: readQuota(entitlement) })),
    [entitlements.data, maxMeters],
  );

  // One sentence, about the quota that most needs a look. A meter whose usage could not be read has
  // no state and never raises it: not knowing is not the same as being at risk. Among equals the
  // first in display order wins, so the sentence does not jump around between renders.
  const atRisk = React.useMemo(() => {
    let worst: (Meter & { state: UsageState }) | null = null;
    for (const meter of meters) {
      const state = meter.reading.state;
      if (state === null || !isUsageAtRisk(state)) continue;
      if (worst === null || (SEVERITY[state] ?? 0) > (SEVERITY[worst.state] ?? 0)) {
        worst = { ...meter, state };
      }
    }
    return worst;
  }, [meters]);

  if (snapshot.isLoading || entitlements.isLoading) {
    return (
      <div
        data-slot="billing-summary-loading"
        className="ktn-own @container/ktn w-full flex flex-col gap-8 rounded-[1.5rem] border bg-ktn-background p-6"
        aria-busy="true"
      >
        <Skeleton className="h-8 w-56" />
        <div className="flex flex-col gap-8 ktn-wide:flex-row">
          <Skeleton className="h-40 w-full ktn-wide:w-50" />
          <Skeleton className="h-40 flex-1" />
        </div>
      </div>
    );
  }

  if (snapshot.error && !snapshot.data) {
    return <SectionError appearance={merged} unstyled={unstyled} onRetry={snapshot.refetch} />;
  }

  const title = headerText ?? localization.billingSummary.title;
  const description = subheaderText ?? localization.billingSummary.description;

  const statusLabel = sessionState
    ? sessionState.kind === "active"
      ? subscriptionWords.active
      : (described?.status?.label ?? null)
    : term
      ? {
          active: localization.billingSummary.statusActive,
          expired: localization.billingSummary.statusExpired,
          not_started: localization.billingSummary.statusNotStarted,
        }[term.status]
      : null;

  // Raw ISO in, formatted string out — the pack owns the formatting, so the locale
  // travels with it. Same contract as `usageMeters.currentWindow`.
  const termDate = sessionState
    ? (described?.detail ?? null)
    : term
      ? {
          active: () => localization.billingSummary.renewsOn(term.expiresAt),
          expired: () => localization.billingSummary.expiredOn(term.expiresAt),
          not_started: () => localization.billingSummary.startsOn(term.startsAt),
        }[term.status]()
      : null;

  // What the portal says of the money, for whatever the host did not say itself: the price of the
  // subscription while it lasts, and the labels of the payment method it is charged to. A
  // subscription that waits for its first payment has the price of the plan it bought, beside the
  // name of the plan the instance still has: it shows none until it starts.
  const subscription = sessionState?.subscription ?? null;
  const sessionPrice =
    subscription && sessionState?.kind !== "canceled" && sessionState?.kind !== "incomplete"
      ? formatKaitenPrice(subscription.basePrice, localization)
      : null;
  const sessionPaymentMethod = portal?.paymentMethod
    ? (() => {
        const labels = describePaymentMethod(portal.paymentMethod, paymentWords);
        return labels.expiry ? `${labels.label} · ${labels.expiry}` : labels.label;
      })()
    : null;

  const priceLabel =
    typeof billing?.amount === "number"
      ? `${localization.formatMoney(billing.amount, billing.currencyCode ?? DEFAULT_CURRENCY_CODE)}${
          billing.interval ? ` / ${billing.interval}` : ""
        }`
      : sessionPrice;
  const paymentMethodLabel = billing?.paymentMethodLabel ?? sessionPaymentMethod;
  // A session bound to the customer only has no subscription to summarise, and says so.
  const unbound = sessionState?.kind === "unbound";
  const active = sessionState
    ? sessionState.kind === "active" || sessionState.kind === "trial"
    : term?.status === "active";

  if (unstyled) {
    return (
      <section data-slot="billing-summary" className="ktn-own" aria-label={title}>
        <h2>{title}</h2>
        <p>{description}</p>
        {planName ? (
          <p className="ktn-own" data-slot="billing-summary-plan">
            {planName}
          </p>
        ) : null}
        {statusLabel ? (
          <p className="ktn-own" data-slot="billing-summary-status">
            {statusLabel}
            {termDate ? ` — ${termDate}` : ""}
          </p>
        ) : null}
        {unbound ? <p>{subscriptionWords.none}</p> : null}
        {described?.change ? <p>{described.change}</p> : null}
        {described?.notice ? <p role="status">{described.notice}</p> : null}
        {priceLabel ? (
          <p className="ktn-own" data-slot="billing-summary-price">
            {priceLabel}
          </p>
        ) : null}
        {paymentMethodLabel ? <p>{paymentMethodLabel}</p> : null}
        <ul>
          {meters.map(({ entitlement, reading }) => (
            <li key={entitlement.slug}>
              {entitlement.name}:{" "}
              {reading.unavailable
                ? localization.includedFeatures.unavailable
                : `${reading.used.toLocaleString()} / ${(reading.limit ?? 0).toLocaleString()}`}
            </li>
          ))}
        </ul>
        {billing?.onManageBilling ? (
          <button type="button" className="ktn-own" onClick={billing.onManageBilling}>
            {localization.billingSummary.manageBilling}
          </button>
        ) : null}
        {billing?.onViewInvoices ? (
          <button type="button" className="ktn-own" onClick={billing.onViewInvoices}>
            {localization.billingSummary.viewInvoices}
          </button>
        ) : null}
        {onUpgrade ? (
          <button type="button" className="ktn-own" onClick={onUpgrade}>
            {upgradeText ?? localization.billingSummary.upgrade}
          </button>
        ) : null}
      </section>
    );
  }

  const AlertIcon = icons.alertTriangle;

  return (
    /*
     * `@container/ktn` makes this root the box the layout below measures, and `w-full`
     * travels with it by rule (inline-size containment drops an element's own content
     * from its width calculation — see kaiten.css and tests/layout).
     *
     * `md:p-10` is the one thing here still keyed to the window, and knowingly so: a
     * container cannot style ITSELF, so this root's own padding is the single property
     * its own container cannot drive. Driving it would mean wrapping the section in a
     * second element — the frame/wall split the paywall uses — and that is a DOM change
     * to move 16px of desktop padding. It causes no overflow at any tested width
     * (verified by removing it, which changed nothing), so it stays until there is a
     * reason better than tidiness. `PricingTable` and `FeatureCatalog` carry the same
     * exception on their roots.
     */
    <section
      data-slot="billing-summary"
      aria-label={title}
      className={cn(
        "ktn-own @container/ktn w-full flex flex-col gap-8 rounded-[1.5rem] border bg-ktn-background p-6 shadow-ktn-lg md:p-10",
        merged.elements?.card,
      )}
    >
      <header className="ktn-own flex flex-wrap items-start justify-between gap-4">
        <div className="ktn-own flex flex-col gap-1">
          <h2 className="ktn-own font-ktn-display text-[1.75rem] leading-tight font-bold">
            {title}
          </h2>
          <p className="ktn-own text-sm text-ktn-muted-foreground">{description}</p>
        </div>
        {planName ? (
          <span
            data-slot="billing-summary-plan"
            className="ktn-own inline-flex items-center gap-2 rounded-ktn-lg border bg-ktn-card px-3 py-1.5 text-[13px]"
          >
            {/* The dot restates the term's status for someone scanning the header;
                the words are in the left column, so this is decoration and carries
                `aria-hidden` rather than a redundant label. */}
            <span
              aria-hidden="true"
              className={cn(
                "ktn-own size-2 shrink-0 rounded-full",
                active ? "bg-ktn-success" : "bg-ktn-muted-foreground",
              )}
            />
            {planName}
          </span>
        ) : null}
      </header>

      <div className="ktn-own flex flex-col gap-8 ktn-wide:flex-row ktn-wide:gap-10">
        <div className="ktn-own flex flex-col gap-5 ktn-wide:w-50 ktn-wide:shrink-0">
          <p className="ktn-own font-ktn-mono text-[11px] font-medium text-ktn-muted-foreground uppercase">
            {localization.billingSummary.subscription}
          </p>

          {statusLabel ? (
            <div className="ktn-own flex flex-col gap-0.5">
              <p className="ktn-own text-sm font-semibold">{statusLabel}</p>
              {termDate ? (
                <p className="ktn-own text-xs text-ktn-muted-foreground">{termDate}</p>
              ) : null}
              {described?.change ? (
                <p className="ktn-own text-xs text-ktn-muted-foreground">{described.change}</p>
              ) : null}
              {(sessionState?.kind === "canceled" || sessionState?.kind === "incomplete") &&
              described?.notice ? (
                <p className="ktn-own text-xs text-ktn-muted-foreground">{described.notice}</p>
              ) : null}
            </div>
          ) : null}

          {unbound ? (
            <p className="ktn-own text-sm text-ktn-muted-foreground">{subscriptionWords.none}</p>
          ) : null}

          {/* Money and payment method come from the host's `billing`, and under a customer
              session from the portal for whatever the host left out. Under any other mode nothing
              in the API supplies them, so there is nothing to fall back to. */}
          {priceLabel || paymentMethodLabel ? (
            <div className="ktn-own flex flex-col gap-0.5">
              {priceLabel ? <p className="ktn-own text-sm font-semibold">{priceLabel}</p> : null}
              {paymentMethodLabel ? (
                <p className="ktn-own text-xs text-ktn-muted-foreground">{paymentMethodLabel}</p>
              ) : null}
            </div>
          ) : null}

          {billing?.onManageBilling || billing?.onViewInvoices ? (
            <>
              <Separator />
              <div className="ktn-own flex flex-col gap-2">
                {billing.onManageBilling ? (
                  <Button variant="secondary" className="w-full" onClick={billing.onManageBilling}>
                    {localization.billingSummary.manageBilling}
                  </Button>
                ) : null}
                {billing.onViewInvoices ? (
                  <Button variant="ghost" className="w-full" onClick={billing.onViewInvoices}>
                    {localization.billingSummary.viewInvoices}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="ktn-own hidden ktn-wide:block">
          <Separator orientation="vertical" />
        </div>

        <div className="ktn-own flex min-w-0 flex-1 flex-col gap-6">
          <p className="ktn-own font-ktn-mono text-[11px] font-medium text-ktn-muted-foreground uppercase">
            {localization.billingSummary.currentCycleUsage}
          </p>

          {meters.length ? (
            <ul className="ktn-own flex flex-col gap-6">
              {meters.map(({ entitlement, reading }) => {
                const { used, unavailable } = reading;
                const limit = reading.limit ?? 0;

                return (
                  <li key={entitlement.slug} className="ktn-own flex flex-col gap-2">
                    <div className="ktn-own flex items-center justify-between gap-3">
                      <span className="ktn-own truncate text-sm font-semibold">
                        {entitlement.name}
                      </span>
                      {/* A usage read that failed says nothing about how much is used, so the
                          row says that instead of "0 / limit" and a bar of nothing. */}
                      {unavailable ? (
                        <span
                          data-slot="billing-summary-unavailable"
                          className="ktn-own shrink-0 font-ktn-mono text-[13px] text-ktn-muted-foreground"
                        >
                          {localization.billingSummary.usageUnavailable}
                        </span>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="ktn-own shrink-0 font-ktn-mono text-[13px] text-ktn-muted-foreground"
                        >
                          {used.toLocaleString()} / {limit.toLocaleString()} (
                          {reading.percentOfGrant}
                          %)
                        </span>
                      )}
                    </div>
                    {/* The figures above are `aria-hidden` and repeated here as the
                        bar's accessible name, so the row is announced once. */}
                    {unavailable ? null : (
                      <ProgressBar
                        value={used}
                        max={reading.limit ?? -1}
                        overagePercent={reading.overagePercent}
                        aria-label={`${entitlement.name}: ${used.toLocaleString()} / ${limit.toLocaleString()}`}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ktn-own text-sm text-ktn-muted-foreground">
              {localization.billingSummary.noUsage}
            </p>
          )}

          {sessionState?.kind === "past_due" && described?.notice ? (
            <div
              data-slot="billing-summary-warning"
              role="status"
              className="ktn-own flex items-center gap-3 rounded-ktn-lg border border-warning-subtle-foreground/30 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground"
            >
              <AlertIcon className="ktn-own size-4 shrink-0" aria-hidden="true" />
              <span className="ktn-own">{described.notice}</span>
            </div>
          ) : null}

          {atRisk ? (
            <div
              data-slot="billing-summary-warning"
              data-usage-state={atRisk.state}
              role="status"
              className={cn(
                "ktn-own flex items-center gap-3 rounded-ktn-lg border p-3 text-xs",
                // Amber while the quota is served, red once it is spent or breached.
                atRisk.state === "at_limit" || atRisk.state === "over_limit"
                  ? "border-destructive-subtle-foreground/30 bg-destructive-subtle text-destructive-subtle-foreground"
                  : "border-warning-subtle-foreground/30 bg-warning-subtle text-warning-subtle-foreground",
              )}
            >
              <AlertIcon className="ktn-own size-4 shrink-0" aria-hidden="true" />
              <span className="ktn-own">{quotaSentence(atRisk, localization)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {footerText || onUpgrade ? (
        <>
          <Separator />
          <footer className="ktn-own flex flex-wrap items-center justify-between gap-4">
            {footerText ? (
              <p className="ktn-own text-[13px] text-ktn-muted-foreground">{footerText}</p>
            ) : (
              <span />
            )}
            {onUpgrade ? (
              <Button onClick={onUpgrade}>
                {upgradeText ?? localization.billingSummary.upgrade}
              </Button>
            ) : null}
          </footer>
        </>
      ) : null}

      {/* Out to the card's edges, as at the foot of every other card: the margins undo the card's
          padding, and the corners follow its radius inside its 1px border. */}
      <KaitenBranding className="-mx-6 -mb-6 rounded-b-[calc(1.5rem-1px)] md:-mx-10 md:-mb-10" />
    </section>
  );
}
