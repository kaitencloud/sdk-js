import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { useIcons } from "../../appearance/icons.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import {
  useEntitlements,
  useLicense,
  useLicensingSnapshot,
  isCustomerFacing,
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
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { ProgressBar } from "../shared/progress-bar.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { isUnlimited } from "../shared/unlimited.tsx";

/** The share of a quota past which the panel raises its warning. Mirrors `ProgressBar`. */
const WARNING_THRESHOLD = 80;

/**
 * What the host has to tell us, because the API does not know it.
 *
 * Kaiten has no money model: a licence carries no price, `LicensingSnapshot.capabilities`
 * reports `paymentMethods: false` / `invoices: false` as a hard-coded literal on BOTH
 * read paths, and there is no invoice or payment-method resource anywhere in the core
 * (see AUDIT_SDK_FIGMA_2026-08.md). So these fields are host-supplied and have NO
 * fallback to the snapshot — deliberately.
 *
 * Anything absent here is not rendered at all. That is the whole point: a price wired
 * to a source that always returns nothing would render an empty slot indistinguishable
 * from a customer who genuinely has no price, and it would do it silently.
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

function numberOf(value: ResolvedEntitlement["currentValue"]): number {
  return value?.type === "number" ? value.value : 0;
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

  const term = snapshot.data?.licenseTerm ?? null;
  // A customer session has no licence: its portal names the plan.
  const planName = license.data?.name ?? snapshot.data?.currentPlan?.name ?? null;

  const meters = React.useMemo(
    () => meteredEntitlements(entitlements.data ?? []).slice(0, maxMeters),
    [entitlements.data, maxMeters],
  );

  const breached = React.useMemo(
    () =>
      meters
        .map((entitlement) => {
          const limit = numberOf(entitlement.limitValue);
          const used = numberOf(entitlement.currentValue);
          const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
          return { entitlement, percentage };
        })
        .find((row) => row.percentage >= WARNING_THRESHOLD),
    [meters],
  );

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

  const statusLabel = term
    ? {
        active: localization.billingSummary.statusActive,
        expired: localization.billingSummary.statusExpired,
        not_started: localization.billingSummary.statusNotStarted,
      }[term.status]
    : null;

  // Raw ISO in, formatted string out — the pack owns the formatting, so the locale
  // travels with it. Same contract as `usageMeters.currentWindow`.
  const termDate = term
    ? {
        active: () => localization.billingSummary.renewsOn(term.expiresAt),
        expired: () => localization.billingSummary.expiredOn(term.expiresAt),
        not_started: () => localization.billingSummary.startsOn(term.startsAt),
      }[term.status]()
    : null;

  const priceLabel =
    typeof billing?.amount === "number"
      ? `${localization.formatMoney(billing.amount, billing.currencyCode ?? DEFAULT_CURRENCY_CODE)}${
          billing.interval ? ` / ${billing.interval}` : ""
        }`
      : null;

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
        {priceLabel ? (
          <p className="ktn-own" data-slot="billing-summary-price">
            {priceLabel}
          </p>
        ) : null}
        {billing?.paymentMethodLabel ? <p>{billing.paymentMethodLabel}</p> : null}
        <ul>
          {meters.map((entitlement) => (
            <li key={entitlement.slug}>
              {entitlement.name}: {numberOf(entitlement.currentValue).toLocaleString()} /{" "}
              {numberOf(entitlement.limitValue).toLocaleString()}
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
                term?.status === "active" ? "bg-ktn-success" : "bg-ktn-muted-foreground",
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
            </div>
          ) : null}

          {/* Money and payment method render ONLY from `billing`. See the type's note:
              nothing in the API supplies them, so there is nothing to fall back to. */}
          {priceLabel || billing?.paymentMethodLabel ? (
            <div className="ktn-own flex flex-col gap-0.5">
              {priceLabel ? <p className="ktn-own text-sm font-semibold">{priceLabel}</p> : null}
              {billing?.paymentMethodLabel ? (
                <p className="ktn-own text-xs text-ktn-muted-foreground">
                  {billing.paymentMethodLabel}
                </p>
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
              {meters.map((entitlement) => {
                const used = numberOf(entitlement.currentValue);
                const limit = numberOf(entitlement.limitValue);
                const percentage = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

                return (
                  <li key={entitlement.slug} className="ktn-own flex flex-col gap-2">
                    <div className="ktn-own flex items-center justify-between gap-3">
                      <span className="ktn-own truncate text-sm font-semibold">
                        {entitlement.name}
                      </span>
                      <span
                        aria-hidden="true"
                        className="ktn-own shrink-0 font-ktn-mono text-[13px] text-ktn-muted-foreground"
                      >
                        {used.toLocaleString()} / {limit.toLocaleString()} ({Math.round(percentage)}
                        %)
                      </span>
                    </div>
                    {/* The figures above are `aria-hidden` and repeated here as the
                        bar's accessible name, so the row is announced once. */}
                    <ProgressBar
                      value={used}
                      max={limit}
                      aria-label={`${entitlement.name}: ${used.toLocaleString()} / ${limit.toLocaleString()}`}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="ktn-own text-sm text-ktn-muted-foreground">
              {localization.billingSummary.noUsage}
            </p>
          )}

          {breached ? (
            <div
              data-slot="billing-summary-warning"
              role="status"
              className="ktn-own flex items-center gap-3 rounded-ktn-lg border border-warning-subtle-foreground/30 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground"
            >
              <AlertIcon className="ktn-own size-4 shrink-0" aria-hidden="true" />
              <span className="ktn-own">
                {localization.billingSummary.quotaWarning(
                  breached.entitlement.name,
                  Math.round(breached.percentage),
                )}
              </span>
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

      <KaitenBranding />
    </section>
  );
}
