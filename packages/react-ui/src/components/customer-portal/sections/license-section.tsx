import * as React from "react";

import {
  useCredits,
  useLicense,
  useLicensingSnapshot,
  usePlans,
  emitKaitenEvent,
  resolveLicensePrice,
  useLocalization,
  DEFAULT_CURRENCY_CODE,
  type LicenseType,
} from "@kaitencloud/react";
import { useIcons } from "../../../appearance/icons.tsx";
import { useMergedAppearance } from "../../../appearance/context.tsx";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { kaitenPriceParts, useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Button } from "../../ui/button.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import { useSubscriptionWords } from "../../shared/billing-words.ts";
import {
  describeSubscription,
  useSubscriptionState,
  type StatusTone,
} from "../../shared/subscription-state.ts";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { SubscriptionControls } from "./subscription-controls.tsx";

function licenseTypeBadgeVariant(
  type: LicenseType,
): "default" | "secondary" | "success" | "outline" {
  switch (type) {
    case "PAID":
      return "default";
    case "TRIAL":
      return "secondary";
    case "COMMUNITY":
      return "success";
    case "DEVELOPMENT":
      return "outline";
  }

  return "outline";
}

const STATUS_VARIANT: Record<
  StatusTone,
  "default" | "secondary" | "destructive" | "success" | "outline"
> = {
  neutral: "secondary",
  warning: "destructive",
  success: "success",
};

export interface CurrentPlanProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /**
   * Under `mode="customer-session"`, adds the controls to cancel the subscription at the end of its
   * period and to withdraw that cancellation, as the portal allows them. Off unless asked for:
   * `CustomerPortal` asks. A plan card on a page of the host's own does not cancel anything.
   */
  manage?: boolean;
  onUpgradeVersion?: () => void | Promise<void>;
  onAddQuota?: () => void | Promise<void>;
  onAddAddOn?: () => void | Promise<void>;
}

async function runAction(
  callback: (() => void | Promise<void>) | undefined,
  eventName: "kaiten:plan-changed" | "kaiten:quota-added" | "kaiten:addon-added",
  detail: Record<string, unknown> = {},
): Promise<void> {
  await callback?.();
  // Carry the context the SDK actually has at click time. `plan-changed`
  // gets the current plan; `quota-added`/`addon-added` are intent events — the
  // specific credit/add-on is only known to the host's callback, which can emit
  // a richer follow-up event after it completes the change.
  emitKaitenEvent(eventName, detail);
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const CurrentPlan = /* @__PURE__ */ React.memo(CurrentPlanImpl);

function CurrentPlanImpl({
  appearance,
  unstyled = false,
  manage = false,
  onUpgradeVersion,
  onAddQuota,
  onAddAddOn,
}: CurrentPlanProps) {
  useAssertWrappedByKaitenProvider("CurrentPlan");
  useTrackComponent("CurrentPlan");

  const merged = useMergedAppearance(appearance);
  const license = useLicense();
  const snapshot = useLicensingSnapshot();
  const { isLoading, error, refetch } = license;
  const credits = useCredits();
  const plans = usePlans();
  const icons = useIcons();
  const localization = useLocalization();
  const subscriptionWords = useSubscriptionWords();
  const subscriptionState = useSubscriptionState();
  const [pendingAction, setPendingAction] = React.useState<"upgrade" | "quota" | "addon" | null>(
    null,
  );

  // What there is to say about the plan. A customer's licence says it all: version,
  // type, renewal. A customer session has no licence, only what its portal names: the
  // plan, and the subscription, whose period is when it renews, and whose price is what
  // is paid for it. Nothing here is made up for the lack of one.
  const subscription = snapshot.data?.subscription ?? null;
  const plan = React.useMemo(() => {
    if (license.data) {
      return {
        slug: license.data.slug,
        name: license.data.name,
        version: license.data.versionName ?? license.data.version,
        type: license.data.type,
        renewalDate: license.data.renewalDate,
      };
    }
    const named = snapshot.data?.currentPlan;
    if (!named) return null;
    return {
      slug: named.slug,
      name: named.name,
      version: undefined,
      type: undefined,
      renewalDate: undefined,
    };
  }, [license.data, snapshot.data?.currentPlan]);

  // What the portal says of the subscription, in a customer session: its status, when it renews or
  // ends, a plan change that is scheduled. A licence says its own renewal; nothing here reads it.
  const described = React.useMemo(
    () =>
      license.data || !subscriptionState
        ? null
        : describeSubscription(subscriptionState, subscriptionWords, localization),
    [license.data, subscriptionState, subscriptionWords, localization],
  );
  const renewal = plan?.renewalDate ? localization.currentPlan.renewsOn(plan.renewalDate) : null;
  const detail = described ? described.detail : renewal;

  // The portal shows what the customer holds, and until now that never included
  // what they pay for it: the price lives on `Plan`, the section reads
  // `License`, and nothing joined them. Both are in the same snapshot, so the
  // join costs no request. A customer session has the subscription's own base price.
  //
  // `null` is the answer when the licence has no matching plan price, or when no
  // subscription is live, and it renders nothing at all. Not a "0.00", not a
  // placeholder: an invented amount on a billing screen is worse than an absent line.
  const price = React.useMemo(() => {
    if (!license.data) {
      return subscription && subscription.status !== "CANCELED" ? subscription.basePrice : null;
    }
    return resolveLicensePrice(license.data, plans.data);
  }, [license.data, plans.data, subscription]);
  const priceParts = price
    ? kaitenPriceParts(price, localization, { currencyCode: DEFAULT_CURRENCY_CODE })
    : null;
  const formattedPrice = priceParts
    ? `${priceParts.amount}${priceParts.suffix ? `${priceParts.attached ? "" : " "}${priceParts.suffix}` : ""}`
    : null;

  const trigger = React.useCallback(
    async (
      key: "upgrade" | "quota" | "addon",
      callback: (() => void | Promise<void>) | undefined,
      eventName: "kaiten:plan-changed" | "kaiten:quota-added" | "kaiten:addon-added",
    ) => {
      setPendingAction(key);
      try {
        const detail =
          eventName === "kaiten:plan-changed" ? { planId: plan?.slug, planName: plan?.name } : {};
        await runAction(callback, eventName, detail);
      } finally {
        setPendingAction(null);
      }
    },
    [plan?.slug, plan?.name],
  );

  if (isLoading) {
    return (
      <Card className={cn(merged.elements?.card)}>
        <CardHeader className={cn(merged.elements?.cardHeader)}>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-36" />
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }

  if (error && !plan) {
    return <SectionError onRetry={refetch} appearance={merged} unstyled={unstyled} />;
  }
  if (!plan) return null;

  const ShieldIcon = icons.shield;

  if (unstyled) {
    return (
      <section data-slot="current-plan" className="ktn-own">
        <h3>{localization.currentPlan.title}</h3>
        <p>{plan.name}</p>
        {plan.version ? <p>{plan.version}</p> : null}
        {plan.type ? <p>{plan.type}</p> : null}
        {described?.status ? (
          <p data-slot="current-plan-status" className="ktn-own">
            {described.status.label}
          </p>
        ) : null}
        {formattedPrice ? (
          <p data-slot="current-plan-price" className="ktn-own">
            {formattedPrice}
          </p>
        ) : null}
        {detail ? <p>{detail}</p> : null}
        {described?.change ? <p>{described.change}</p> : null}
        {described?.notice ? <p role="status">{described.notice}</p> : null}
        {credits.data?.length ? (
          <ul>
            {credits.data.map((credit) => (
              <li key={credit.slug}>
                {credit.name}: {credit.available} {credit.unit}
              </li>
            ))}
          </ul>
        ) : null}
        {/* Same rule as the styled rendering below: an action with no handler is
            not rendered. The two branches are one component to a consumer, so a
            guard that holds in only one of them is not a guard. */}
        {(onUpgradeVersion || onAddQuota || onAddAddOn) && (
          <div>
            {onUpgradeVersion && (
              <button
                type="button"
                onClick={() =>
                  void runAction(onUpgradeVersion, "kaiten:plan-changed", {
                    planId: plan.slug,
                    planName: plan.name,
                  })
                }
              >
                {localization.currentPlan.upgradeVersion}
              </button>
            )}
            {onAddQuota && (
              <button
                type="button"
                onClick={() => void runAction(onAddQuota, "kaiten:quota-added")}
              >
                {localization.currentPlan.addQuota}
              </button>
            )}
            {onAddAddOn && (
              <button
                type="button"
                onClick={() => void runAction(onAddAddOn, "kaiten:addon-added")}
              >
                {localization.currentPlan.addAddOns}
              </button>
            )}
          </div>
        )}
        {manage && subscriptionState ? (
          <SubscriptionControls state={subscriptionState} unstyled />
        ) : null}
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn("flex items-center gap-2", merged.elements?.cardTitle)}>
          <ShieldIcon className="size-4 text-ktn-primary" />
          {localization.currentPlan.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("flex flex-col gap-4", merged.elements?.cardContent)}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-base font-semibold">{plan.name}</p>
            {plan.version ? (
              <p className="text-sm text-ktn-muted-foreground">{plan.version}</p>
            ) : null}
            {priceParts ? (
              <p data-slot="current-plan-price" className="ktn-own text-sm font-medium">
                {priceParts.amount}
                {priceParts.suffix ? (
                  <span className="font-normal text-ktn-muted-foreground">
                    {priceParts.attached ? "" : " "}
                    {priceParts.suffix}
                  </span>
                ) : null}
              </p>
            ) : null}
            {detail ? <p className="text-xs text-ktn-muted-foreground">{detail}</p> : null}
            {described?.change ? (
              <p className="text-xs text-ktn-muted-foreground">{described.change}</p>
            ) : null}
          </div>
          {plan.type ? (
            <Badge variant={licenseTypeBadgeVariant(plan.type)}>{plan.type}</Badge>
          ) : described?.status ? (
            <Badge
              data-slot="current-plan-status"
              className="ktn-own"
              variant={STATUS_VARIANT[described.status.tone]}
            >
              {described.status.label}
            </Badge>
          ) : null}
        </div>

        {described?.notice ? (
          <p
            role="status"
            className="rounded-ktn-lg border border-ktn-border bg-ktn-secondary/40 p-3 text-sm"
          >
            {described.notice}
          </p>
        ) : null}

        {credits.data?.length ? (
          <div className="rounded-ktn-lg border border-ktn-border bg-ktn-secondary/40 p-3">
            <p className="mb-2 text-sm font-medium">{localization.currentPlan.credits}</p>
            <div className="grid gap-2">
              {credits.data.map((credit) => (
                <div key={credit.slug} className="flex items-center justify-between gap-3 text-sm">
                  <span>{credit.name}</span>
                  <span className="font-mono text-ktn-muted-foreground">
                    {credit.available.toLocaleString()} {credit.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/*
          Each action renders only when the host gave it a handler — same rule as
          `Paywall`, which shows its CTA only when `onUpgrade` exists. Rendering
          them unconditionally meant a host that passed no callbacks (the common
          case while billing is still being built) shipped three buttons that
          flicker `aria-busy` and do nothing. A component sold to third parties
          must not be able to display a dead CTA.
        */}
        {(onUpgradeVersion || onAddQuota || onAddAddOn) && (
          <div className={cn("flex flex-wrap gap-2", merged.elements?.actionRow)}>
            {onUpgradeVersion && (
              <Button
                size="sm"
                disabled={pendingAction === "upgrade"}
                aria-busy={pendingAction === "upgrade"}
                onClick={() => void trigger("upgrade", onUpgradeVersion, "kaiten:plan-changed")}
              >
                {localization.currentPlan.upgradeVersion}
              </Button>
            )}
            {onAddQuota && (
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction === "quota"}
                aria-busy={pendingAction === "quota"}
                onClick={() => void trigger("quota", onAddQuota, "kaiten:quota-added")}
              >
                {localization.currentPlan.addQuota}
              </Button>
            )}
            {onAddAddOn && (
              <Button
                size="sm"
                variant="outline"
                disabled={pendingAction === "addon"}
                aria-busy={pendingAction === "addon"}
                onClick={() => void trigger("addon", onAddAddOn, "kaiten:addon-added")}
              >
                {localization.currentPlan.addAddOns}
              </Button>
            )}
          </div>
        )}

        {manage && subscriptionState ? (
          <SubscriptionControls state={subscriptionState} unstyled={false} />
        ) : null}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}

export function LicenseSection(props: CurrentPlanProps) {
  return <CurrentPlan {...props} />;
}
