import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { cn } from "../../lib/utils.ts";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/card.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button, buttonVariants } from "../ui/button.tsx";
import { Separator } from "../ui/separator.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { useIcons } from "../../appearance/icons.tsx";
import {
  usePlans,
  useLocalization,
  DEFAULT_CURRENCY_CODE,
  type BillingInterval,
  type BillingPrice,
  type Plan,
  type PlanPrice,
} from "@kaitencloud/react";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import {
  isHeadlinePrice,
  kaitenPriceParts,
  useTrackComponent,
  type KaitenPriceParts,
} from "@kaitencloud/react/internal";
import { FeatureComparison } from "../feature-comparison/feature-comparison.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { CardLoading } from "../shared/loading.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { isUnlimited, UnlimitedValue } from "../shared/unlimited.tsx";

export type PricingPlan = Plan;

type PlanEntitlement = NonNullable<Plan["entitlements"]>[number];

// A plan entitlement's displayed value: an explicit label wins, an unlimited
// grant renders as ∞ (server-computed flag first, value sentinel as fallback),
// any other number is formatted, and non-numeric falls back to type.
function renderEntitlementValue(entitlement: PlanEntitlement): React.ReactNode {
  if (entitlement.label) return entitlement.label;
  if (entitlement.value?.type === "number") {
    const unlimited = entitlement.unlimited ?? isUnlimited(entitlement.value.value);
    return unlimited ? <UnlimitedValue /> : entitlement.value.value.toLocaleString();
  }
  return entitlement.type;
}

type PricingLayout = "merged" | "separate";

/**
 * The plan grid's columns, decided by how wide a card needs to be rather than by the
 * browser window.
 *
 * These used to be breakpoint variants keyed to the viewport, which is the wrong
 * number for an embedded SDK. The host owns the window; the SDK only gets a slot. A
 * wide window rendered three columns in a 300px slot (51px per card) and a narrow one
 * rendered a single column in a 1230px slot. Both from the same markup.
 *
 * (Written without naming those classes on purpose: the CSS build scans source text,
 * so spelling one in a comment ships its rule — which would leave the stylesheet
 * carrying the exact utilities this change removes.)
 *
 * `auto-fit` needs no breakpoints at all, because the column count is arithmetic:
 *
 *   minmax(min(100%, max(17rem, (100% - gutters) / N)), 1fr)
 *          └─ never wider ─┘  └─ card floor ┘ └─ the N cap ┘
 *
 *   17rem  the narrowest a plan card stays readable. Measured, not chosen: the widest
 *          card's min-content is 262px across the shipped stories, and 17rem/272px
 *          clears it while still fitting four columns at the 1182px grid a 1280px
 *          window produces — so the column counts this replaces are preserved exactly.
 *   N cap  an Nth of the row, which is what keeps `numberOfColumns` meaningful: as the
 *          floor it stops a wider container from adding an unwanted column. It only
 *          ever raises the floor, so a container too narrow for N columns still gets
 *          fewer rather than being forced.
 *   100%   the outer clamp, and not optional: 17rem overflows a container narrower
 *          than 17rem, which at a 320px slot is exactly what happens.
 *
 * The `1.25rem` gutters must track the `gap-5` on the grid itself; they are the only
 * coupling here, and getting them wrong costs one column at the widest size, not a
 * broken layout. Returned as whole literal strings because the CSS build scans source
 * text for class names — a template literal would assemble a class no scanner can see,
 * and it would be dropped silently (see scripts/build-kaiten-css.ts).
 */
function resolveColumns(count: 2 | 3 | 4): string {
  switch (count) {
    case 2:
      return "grid-cols-[repeat(auto-fit,minmax(min(100%,max(17rem,(100%_-_1.25rem)/2)),1fr))]";
    case 4:
      return "grid-cols-[repeat(auto-fit,minmax(min(100%,max(17rem,(100%_-_3.75rem)/4)),1fr))]";
    case 3:
    default:
      return "grid-cols-[repeat(auto-fit,minmax(min(100%,max(17rem,(100%_-_2.5rem)/3)),1fr))]";
  }
}

/**
 * The price a card shows for the selected interval.
 *
 * Only a flat fee billed every single `interval` qualifies: a quarterly price
 * (`interval: "month"`, `intervalCount: 3`) under "/month" would read as a
 * third of what it costs, and a usage price as the whole bill. Among several,
 * the default one. The suffix under the amount is written from the price itself,
 * in the pack's language: never from its free-text `label` ("Monthly" from the API
 * made "€49.00/Monthly").
 *
 * A plan that sells nothing for the interval shows the price it has, with its own
 * period: a plan with a monthly fee only reads "/month" when the visitor picks
 * "Annual", never "/year". A plan whose only default flat fee is quarterly shows it
 * as "every 3 months".
 *
 * `price` is what `onSelectPlan` hands back: the price of the plan the card showed,
 * when it showed one of its prices, as a checkout names it.
 */
function getPlanPrice(
  plan: Plan,
  interval: BillingInterval,
): { display?: PlanPrice | BillingPrice; price?: PlanPrice } {
  const candidates = plan.prices?.filter((price) => isHeadlinePrice(price, interval)) ?? [];
  const matchedPrice = candidates.find((price) => price.isDefault) ?? candidates[0];
  if (matchedPrice) {
    return { display: matchedPrice, price: matchedPrice };
  }

  if (interval === "year" && typeof plan.annualPrice === "number") {
    return { display: { amount: plan.annualPrice, interval: "year" } };
  }

  // Nothing is sold for this interval: the plan's default flat fee of the shortest
  // period, from the 1.0-typed list and from the catalog's own, which also holds the
  // quarterly and half-yearly ones. It keeps its own period and its own id.
  const periodInMonths = (price: PlanPrice) =>
    (price.intervalCount ?? 1) * (price.interval === "year" ? 12 : 1);
  const own = [...(plan.prices ?? []), ...(plan.billingPrices ?? [])]
    .filter(
      (price): price is PlanPrice =>
        price.isDefault === true &&
        (price.billingModel ?? "FLAT_FEE") === "FLAT_FEE" &&
        typeof price.amount === "number" &&
        (price.interval === "month" || price.interval === "year"),
    )
    .sort((a, b) => periodInMonths(a) - periodInMonths(b))[0];
  if (own) return { display: own, price: own };

  // `price` is the monthly fee, unless the plan says what its interval is.
  if (typeof plan.price === "number") {
    return { display: { amount: plan.price, interval: plan.interval ?? "month" } };
  }
  return {};
}

// Render a plan's price WITHOUT the silent `?? 0` coercion that made paid tiers
// publish as "0,00 €" on a public pricing page when no money model supplied an
// amount. When the amount is missing we show a localized "Custom" label (and the
// interval suffix is dropped) so the host is forced to notice, not ship a fake €0.
function renderPlanPrice(
  price: PlanPrice | BillingPrice | undefined,
  currencyCode: string,
  localization: ReturnType<typeof useLocalization>,
): KaitenPriceParts {
  const parts = price && kaitenPriceParts(price, localization, { currencyCode });
  return parts ?? { amount: localization.pricingTable.customPrice, suffix: "", attached: true };
}

// Add-ons follow the same rule as the plan price above. `?? 0` published a paid
// add-on as "0,00 €" whenever no money model supplied an amount — a wrong price
// on a public page is worse than an honest "Custom", and it was the one place
// the coercion survived after the plan price was fixed.
function renderAddonPrice(
  addon: NonNullable<Plan["addOns"]>[number],
  fallbackCurrencyCode: string | undefined,
  localization: ReturnType<typeof useLocalization>,
): string {
  const amount = addon.price ?? addon.prices?.find((price) => isHeadlinePrice(price))?.amount;
  if (typeof amount !== "number") return localization.pricingTable.customPrice;
  return localization.formatMoney(
    amount,
    addon.currencyCode ?? fallbackCurrencyCode ?? DEFAULT_CURRENCY_CODE,
  );
}

function renderCtaText(
  ctaText: PricingTableProps["ctaText"],
  plan: Plan,
  isHighlighted: boolean,
  localization: ReturnType<typeof useLocalization>,
): string {
  if (typeof ctaText === "function") {
    return ctaText(plan);
  }

  if (ctaText) return ctaText;
  return isHighlighted
    ? localization.pricingTable.choosePlan
    : localization.pricingTable.selectPlan;
}

/**
 * What a plan's card offers.
 *
 * A self-serve plan, or one the catalog says nothing about, gets the select
 * button. A plan that is not self-serve — "Contact us" for a CUSTOM one —
 * links to its `selfServeCtaUrl`, and offers nothing when it has none: a
 * button that leads nowhere is worse than no button.
 */
function planCta(plan: Plan): { href: string } | "select" | null {
  if (plan.selfServe !== false) return "select";
  return plan.selfServeCtaUrl ? { href: plan.selfServeCtaUrl } : null;
}

/** Calls `onSelectPlan` with the price only when the card showed one. */
function selectPlan(
  onSelectPlan: PricingTableProps["onSelectPlan"],
  plan: Plan,
  price: PlanPrice | undefined,
): void {
  if (price) onSelectPlan?.(plan.slug, plan, price);
  else onSelectPlan?.(plan.slug, plan);
}

export interface PricingTableProps {
  plans?: PricingPlan[];
  highlightPlan?: string;
  hidePlans?: string[];
  /**
   * Called with the plan the visitor picked and, when the card showed one, the
   * price it showed: its `id` is what a checkout names as `licensePriceId`.
   * Only self-serve plans, and plans whose catalog says nothing about it, offer
   * this action; the others link to their `selfServeCtaUrl`.
   */
  onSelectPlan?: (planId: string, plan: PricingPlan, price?: PlanPrice) => void;
  appearance?: KaitenAppearance;
  numberOfColumns?: 2 | 3 | 4;
  sectionLayout?: PricingLayout;
  headerText?: string;
  /**
   * Small uppercase marker rendered above the title as an overline pill. Purely
   * editorial — the catalog has no field for it, so the host supplies the wording.
   */
  eyebrowText?: string;
  /** Supporting line under the title. Host-supplied for the same reason. */
  subheaderText?: string;
  ctaText?: string | ((plan: PricingPlan) => string);
  showAnnualToggle?: boolean;
  showFeatureComparison?: boolean;
  unstyled?: boolean;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export function PricingTable(props: PricingTableProps) {
  useAssertWrappedByKaitenProvider("PricingTable");
  useTrackComponent("PricingTable");

  const merged = useMergedAppearance(props.appearance);
  const icons = useIcons();
  const plansQuery = usePlans();
  const deferredPlans = React.useDeferredValue(plansQuery.data ?? []);
  const plans = props.plans ?? deferredPlans;

  // Host-supplied plans own their own lifecycle: the query's loading/error state
  // describes a fetch this component did not make on the host's behalf, so it
  // must not be surfaced. Only the catalog we fetched ourselves can report one.
  const hostSupplied = props.plans !== undefined;

  return (
    <PricingTableView
      {...props}
      plans={plans}
      merged={merged}
      icons={icons}
      isLoading={hostSupplied ? false : plansQuery.isLoading}
      error={hostSupplied ? null : plansQuery.error}
      onRetry={hostSupplied ? undefined : plansQuery.refetch}
    />
  );
}

/**
 * Placeholder shown while the catalog loads. The `unstyled` branch comes FIRST:
 * putting the loading test first is the defect that makes every other section
 * emit Tailwind markup in unstyled mode.
 */
function PricingTableLoading({
  unstyled,
  appearance,
}: {
  unstyled: boolean;
  appearance: KaitenAppearance | undefined;
}) {
  const localization = useLocalization();

  if (unstyled) {
    return (
      <section data-slot="pricing-table-loading" className="ktn-own" aria-busy="true">
        <p>{localization.states.loading}</p>
      </section>
    );
  }

  return (
    <Card
      className={cn("ktn-own", appearance?.elements?.card)}
      data-slot="pricing-table-loading"
      aria-busy="true"
    >
      <CardLoading />
    </Card>
  );
}

function PricingTableView({
  plans,
  highlightPlan,
  hidePlans,
  onSelectPlan,
  numberOfColumns = 3,
  sectionLayout = "merged",
  headerText,
  eyebrowText,
  subheaderText,
  ctaText,
  showAnnualToggle = true,
  showFeatureComparison = true,
  unstyled = false,
  merged,
  icons,
  isLoading = false,
  error = null,
  onRetry,
}: Required<Pick<PricingTableProps, "plans">> &
  Omit<PricingTableProps, "plans" | "appearance"> & {
    merged: ReturnType<typeof useMergedAppearance>;
    icons: ReturnType<typeof useIcons>;
    isLoading?: boolean;
    error?: Error | null;
    onRetry?: () => void;
  }) {
  const localization = useLocalization();

  // `published` is the catalog's own visibility flag — `planFromLicense` maps it
  // from `license.lifecycleState`, so a host's draft or archived licenses arrive
  // here as `published: false`. Nothing read it before, which put those licenses
  // on the adopter's PUBLIC pricing page. `!== false` (not a truthiness test) is
  // deliberate and matches `useUpgradeOptions`: `undefined` means "the read path
  // didn't say" (host-supplied `plans`, older API) and must stay visible — only
  // an explicit `false` hides a plan.
  const visiblePlans = React.useMemo(
    () => plans.filter((plan) => plan.published !== false && !hidePlans?.includes(plan.slug)),
    [hidePlans, plans],
  );

  const hasAnnualPlans = visiblePlans.some((plan) =>
    Boolean(plan.prices?.some((price) => isHeadlinePrice(price, "year")) || plan.annualPrice),
  );
  const [interval, setInterval] = React.useState<BillingInterval>("month");

  React.useEffect(() => {
    if (!hasAnnualPlans && interval === "year") {
      setInterval("month");
    }
  }, [hasAnnualPlans, interval]);

  // Dev guard (R-?): a plan with no resolvable amount used to render a silent
  // "0,00 €". It now shows the localized `customPrice` label, but warn so the
  // adopter wires real prices (Kaiten has no server-side money model — prices are
  // host-supplied) instead of unknowingly publishing "Custom" everywhere.
  React.useEffect(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") return;
    const priceless = visiblePlans.filter(
      (plan) => getPlanPrice(plan, interval).display === undefined,
    );
    if (priceless.length) {
      console.warn(
        `[@kaitencloud/react] PricingTable: ${priceless.length} plan(s) have no ${interval} price (${priceless
          .map((plan) => plan.slug)
          .join(
            ", ",
          )}); rendering the "${localization.pricingTable.customPrice}" label. Supply prices via the \`plans\` prop or per-plan \`price\`/\`prices\`.`,
      );
    }
  }, [interval, localization.pricingTable.customPrice, visiblePlans]);

  // A pricing page whose catalog failed to load used to render exactly like an
  // empty catalog: nothing at all. The host could not tell a broken page from a
  // legitimately empty one, and neither could its monitoring. Distinguish the
  // three cases — but only when there is nothing to show: once plans have
  // arrived, a background refetch or a stale-revalidate error must not replace
  // a working table with a spinner.
  if (!visiblePlans.length) {
    if (error) return <SectionError appearance={merged} unstyled={unstyled} onRetry={onRetry} />;
    if (isLoading) return <PricingTableLoading unstyled={unstyled} appearance={merged} />;
    return null;
  }

  if (unstyled) {
    return (
      <div data-slot="pricing-table" className="ktn-own">
        {eyebrowText ? (
          <p className="ktn-own" data-slot="pricing-table-eyebrow">
            {eyebrowText}
          </p>
        ) : null}
        {headerText ? <h2>{headerText}</h2> : null}
        {subheaderText ? (
          <p className="ktn-own" data-slot="pricing-table-subheader">
            {subheaderText}
          </p>
        ) : null}
        {showAnnualToggle && hasAnnualPlans ? (
          <div role="radiogroup" aria-label={localization.pricingTable.billingInterval}>
            <button
              type="button"
              role="radio"
              aria-checked={interval === "month"}
              onClick={() => setInterval("month")}
            >
              {localization.pricingTable.monthly}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={interval === "year"}
              onClick={() => setInterval("year")}
            >
              {localization.pricingTable.annual}
            </button>
          </div>
        ) : null}
        <div>
          {visiblePlans.map((plan) => {
            const price = getPlanPrice(plan, interval);
            const rendered = renderPlanPrice(
              price.display,
              plan.currencyCode ?? DEFAULT_CURRENCY_CODE,
              localization,
            );
            return (
              <article key={plan.slug}>
                <h3>{plan.name}</h3>
                {plan.description ? <p>{plan.description}</p> : null}
                <p>
                  {rendered.amount}
                  {rendered.suffix ? `${rendered.attached ? "" : " "}${rendered.suffix}` : null}
                </p>
                <ul>
                  {(plan.features ?? []).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {(() => {
                  const cta = planCta(plan);
                  if (cta === null) return null;
                  if (cta !== "select") {
                    return <a href={cta.href}>{localization.pricingTable.contactUs}</a>;
                  }
                  return (
                    <button
                      type="button"
                      onClick={() => selectPlan(onSelectPlan, plan, price.price)}
                    >
                      {renderCtaText(
                        ctaText,
                        plan,
                        plan.slug === highlightPlan || !!plan.highlighted,
                        localization,
                      )}
                    </button>
                  );
                })()}
              </article>
            );
          })}
        </div>
        {showFeatureComparison ? <FeatureComparison plans={visiblePlans} unstyled /> : null}
        {!showFeatureComparison ? <KaitenBranding unstyled /> : null}
      </div>
    );
  }

  const CheckIcon = icons.check;

  return (
    <div
      data-slot="pricing-table"
      className={cn(
        // The widget's own panel, as the design draws it. `bg-ktn-background` is the
        // outermost surface token: #070708 in dark, white in light — exactly the
        // relationship the mock has to its cards in each mode. The cards separate from
        // it by their border rather than by a tint, because that relationship INVERTS
        // between modes (panel darker than cards in dark, lighter in light) and no
        // single fill token holds both. Note this paints a surface on a COMPONENT,
        // never on `.kaiten` itself — see the note in kaiten.css about the provider
        // wrapper painting over its host's page.
        "ktn-own flex flex-col gap-10 rounded-[1.5rem] border bg-ktn-background p-6 md:p-12",
      )}
    >
      {(eyebrowText || headerText || subheaderText || (showAnnualToggle && hasAnnualPlans)) && (
        <div
          className={cn(
            "flex flex-col items-center gap-3 text-center",
            merged.elements?.pricingTableHeader,
          )}
        >
          {eyebrowText ? (
            <Badge shape="pill" variant="secondary" className="border-ktn-border">
              {eyebrowText}
            </Badge>
          ) : null}
          {headerText ? (
            <h2 className="font-ktn-display text-[2rem] leading-tight font-bold text-ktn-foreground">
              {headerText}
            </h2>
          ) : null}
          {subheaderText ? (
            <p className="max-w-[42rem] text-sm text-ktn-muted-foreground">{subheaderText}</p>
          ) : null}
          {showAnnualToggle && hasAnnualPlans ? (
            <div
              role="radiogroup"
              aria-label={localization.pricingTable.billingInterval}
              className="inline-flex items-center rounded-ktn-lg border border-ktn-border bg-ktn-card p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={interval === "month"}
                className={cn(
                  "rounded-ktn-md px-3 py-1.5 text-sm transition-colors",
                  interval === "month"
                    ? "bg-ktn-primary text-ktn-primary-foreground"
                    : "text-ktn-muted-foreground",
                )}
                onClick={() => setInterval("month")}
              >
                {localization.pricingTable.monthly}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={interval === "year"}
                className={cn(
                  "rounded-ktn-md px-3 py-1.5 text-sm transition-colors",
                  interval === "year"
                    ? "bg-ktn-primary text-ktn-primary-foreground"
                    : "text-ktn-muted-foreground",
                )}
                onClick={() => setInterval("year")}
              >
                {localization.pricingTable.annual}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div className={cn("grid items-stretch gap-5", resolveColumns(numberOfColumns))}>
        {visiblePlans.map((plan) => {
          const isHighlighted = plan.highlighted || plan.slug === highlightPlan;
          const resolvedPrice = getPlanPrice(plan, interval);
          const renderedPrice = renderPlanPrice(
            resolvedPrice.display,
            plan.currencyCode ?? DEFAULT_CURRENCY_CODE,
            localization,
          );
          const planFeatures = plan.features ?? [];
          const addOns = plan.addOns ?? [];

          return (
            <Card
              key={plan.slug}
              className={cn(
                "h-full gap-7 rounded-[1rem] py-8",
                // Solid 2px edge plus a soft halo, both off `--ktn-primary`. The mock
                // draws the halo as a purple drop shadow; a token-tinted ring gets the
                // same read without hard-coding a brand hex into a component.
                isHighlighted &&
                  "border-2 border-ktn-primary bg-ktn-popover ring-4 ring-ktn-primary/15",
                merged.elements?.pricingCard,
                isHighlighted && merged.elements?.pricingCardHighlight,
              )}
            >
              <CardHeader className="px-8">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-[1.75rem] leading-tight font-bold">
                    {plan.name}
                  </CardTitle>
                  {(plan.badge || plan.popular || isHighlighted) && (
                    <Badge shape="pill" variant={isHighlighted ? "default" : "secondary"}>
                      {plan.badge ??
                        (plan.popular
                          ? localization.pricingTable.popular
                          : localization.pricingTable.recommended)}
                    </Badge>
                  )}
                </div>
                {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-7 px-8">
                {/*
                 * Keep the price inside the card. It is wider than it looks, and how much
                 * wider depends on the locale: `formatMoney` puts a *non-breaking* space
                 * before the symbol, so `fr-FR` renders "249,00 $US" as a single 171px
                 * token at `text-3xl` where `en-US` renders "$249" at 62px. The card's
                 * content box is ~137px in the standard three-column table, so the same
                 * markup fits comfortably in English and ran straight out over the card's
                 * edge in French, dragging "/month" outside the card with it.
                 *
                 * `flex-wrap` stops the interval being pushed out, and `min-w-0` +
                 * `break-words` let an over-long price wrap inside the card instead of
                 * escaping it. Both are inert when the price fits, which is why the size
                 * is left alone: a width-based step-down cannot see text length, so it
                 * would have shrunk every English table to fix the French one.
                 *
                 * Playwright pins `locale: "en-US"`, so the visual suite never rendered a
                 * price long enough to show this.
                 */}
                <div className="flex flex-wrap items-baseline gap-1">
                  <span className="min-w-0 font-ktn-display text-[2.5rem] leading-none font-bold break-words">
                    {renderedPrice.amount}
                  </span>
                  {renderedPrice.suffix ? (
                    <span className="font-ktn-mono text-[13px] text-ktn-muted-foreground">
                      {renderedPrice.suffix}
                    </span>
                  ) : null}
                </div>

                {sectionLayout === "separate" ? (
                  <div className="flex flex-col gap-4">
                    <section className="flex flex-col gap-2">
                      <h4 className="text-sm font-medium">{localization.pricingTable.features}</h4>
                      <ul className="flex flex-col gap-2">
                        {planFeatures.map((feature) => (
                          <li key={feature} className="flex items-center gap-2 text-sm">
                            <CheckIcon className="size-4 shrink-0 text-ktn-success" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    </section>

                    {plan.entitlements?.length ? (
                      <section className="flex flex-col gap-2">
                        <h4 className="text-sm font-medium">{localization.pricingTable.limits}</h4>
                        <ul className="flex flex-col gap-2 text-sm text-ktn-muted-foreground">
                          {plan.entitlements.map((entitlement) => (
                            <li
                              key={entitlement.slug}
                              className="flex items-center justify-between gap-3"
                            >
                              <span>{entitlement.name}</span>
                              <span>{renderEntitlementValue(entitlement)}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}

                    {addOns.length ? (
                      <section className="flex flex-col gap-2">
                        <h4 className="text-sm font-medium">{localization.pricingTable.addOns}</h4>
                        <ul className="flex flex-col gap-2 text-sm text-ktn-muted-foreground">
                          {addOns.map((addon) => (
                            <li
                              key={addon.slug}
                              className="flex items-center justify-between gap-3"
                            >
                              <span>{addon.name}</span>
                              <span>
                                {renderAddonPrice(addon, plan.currencyCode, localization)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <Separator />
                    <ul className="flex flex-col gap-3">
                      {planFeatures.map((feature) => (
                        <li key={feature} className="flex items-center gap-3 text-sm">
                          <CheckIcon className="size-4 shrink-0 text-ktn-success" />
                          <span>{feature}</span>
                        </li>
                      ))}
                      {plan.entitlements?.map((entitlement) => (
                        <li
                          key={entitlement.slug}
                          className="flex items-center justify-between gap-2 text-sm text-ktn-muted-foreground"
                        >
                          <span>{entitlement.name}</span>
                          <span>{renderEntitlementValue(entitlement)}</span>
                        </li>
                      ))}
                      {addOns.map((addon) => (
                        <li
                          key={addon.slug}
                          className="flex items-center justify-between gap-2 text-sm text-ktn-muted-foreground"
                        >
                          <span>{addon.name}</span>
                          <span>{renderAddonPrice(addon, plan.currencyCode, localization)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </CardContent>
              {(() => {
                const cta = planCta(plan);
                if (cta === null) return null;
                const ctaClassName = cn(
                  "h-12 w-full text-base font-semibold",
                  // The brand gradient, scrimmed for legibility — see `.ktn-cta-gradient`
                  // in kaiten.css. Only the highlighted plan gets it; a table where every
                  // CTA is a gradient has no primary action.
                  isHighlighted && "ktn-cta-gradient",
                );
                const variant = isHighlighted ? "default" : "secondary";
                return (
                  <CardFooter className="px-8">
                    {cta === "select" ? (
                      <Button
                        variant={variant}
                        className={ctaClassName}
                        onClick={() => selectPlan(onSelectPlan, plan, resolvedPrice.price)}
                      >
                        {renderCtaText(ctaText, plan, isHighlighted, localization)}
                      </Button>
                    ) : (
                      <a
                        data-slot="button"
                        href={cta.href}
                        className={cn(
                          "ktn-own",
                          buttonVariants({ variant, size: "default", className: ctaClassName }),
                        )}
                      >
                        {localization.pricingTable.contactUs}
                      </a>
                    )}
                  </CardFooter>
                );
              })()}
              <KaitenBranding className="-mb-8" />
            </Card>
          );
        })}
      </div>

      {showFeatureComparison ? (
        <FeatureComparison plans={visiblePlans} appearance={merged} />
      ) : null}
    </div>
  );
}
