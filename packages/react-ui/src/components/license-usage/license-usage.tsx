// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  isCustomerFacing,
  isPeriodicEntitlement,
  unitLabel,
  usageWindowLabel,
  useLicensingSnapshot,
  useLocalization,
  type KaitenLocalization,
  type LicenseTerm,
  type ResolvedEntitlement,
} from "@kaitencloud/react";
import { useTrackComponent } from "@kaitencloud/react/internal";

import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { ProvenanceNote } from "../customer-portal/sections/provenance-note.tsx";
import { useSubscriptionWords } from "../shared/billing-words.ts";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { ProgressBar } from "../shared/progress-bar.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { useSubscriptionState } from "../shared/subscription-state.ts";
import { isUnlimited } from "../shared/unlimited.tsx";
import { getUsageBadge } from "../shared/usage-badge.ts";
import { readQuota, type QuotaReading } from "../shared/usage-state.ts";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

export interface LicenseUsageProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/** A numeric entitlement of the licence, with where its usage stands read once. */
interface Quota {
  entitlement: ResolvedEntitlement;
  reading: QuotaReading;
  /** What the grant is: nothing caps it. A bar needs a cap to fill against, so it has none. */
  unlimited: boolean;
  /** The granted value. Meaningless when `unlimited`. */
  limit: number;
}

/**
 * The quotas the block lists: every numeric grant the customer is meant to see, capped or not.
 * `UsageMeters` keeps to the capped ones, because a meter needs a cap to fill against; a licence with
 * no cap at all (every licence Kaiten sells today) would have no meter to draw, and a customer would
 * see none of what they use. Booleans and configurations are `IncludedFeatures`' to list, and
 * internal counters (`userFacing: false`) are nobody's.
 */
function quotasOf(entitlements: ResolvedEntitlement[]): Quota[] {
  return entitlements.flatMap((entitlement) => {
    if (!isCustomerFacing(entitlement) || entitlement.limitValue.type !== "number") return [];
    const limit = entitlement.limitValue.value;
    return [
      {
        entitlement,
        reading: readQuota(entitlement),
        // The server's flag over the raw sentinel, as the meters read it.
        unlimited: entitlement.unlimited ?? isUnlimited(limit),
        limit,
      },
    ];
  });
}

/** The licence's term in a sentence, in the words the billing summary uses for it. */
function termSentence(term: LicenseTerm, localization: KaitenLocalization): string {
  switch (term.status) {
    case "active":
      return localization.billingSummary.renewsOn(term.expiresAt);
    case "expired":
      return localization.billingSummary.expiredOn(term.expiresAt);
    case "not_started":
      return localization.billingSummary.startsOn(term.startsAt);
  }
}

/**
 * The figures of a quota in one line: "30,000 / 200,000 calls" for a capped one, "12 seats /
 * Unlimited" for one nothing caps. Said by the quota's unit when the definition has one. A usage that
 * could not be read is not a figure: the line says so in words, and still says when nothing caps it.
 */
function figuresOf(
  { entitlement, reading, unlimited, limit }: Quota,
  localization: KaitenLocalization,
): string {
  const grant = unlimited ? localization.includedFeatures.unlimited : limit.toLocaleString();
  if (reading.unavailable) {
    const words = localization.billingSummary.usageUnavailable;
    return unlimited ? `${words} / ${grant}` : words;
  }
  // The unit follows the count it is said of: the used one beside "Unlimited", the cap beside a cap.
  const unit = unitLabel(entitlement, unlimited ? reading.used : limit);
  const used = reading.used.toLocaleString();
  if (unlimited) return `${unit ? `${used} ${unit}` : used} / ${grant}`;
  return unit ? `${used} / ${grant} ${unit}` : `${used} / ${grant}`;
}

/**
 * The licence a customer holds and what it has used: its name, the trial it may be in, its term when
 * the snapshot has one, and one row for every numeric quota. A capped quota has its figures, a
 * percentage and a bar that follows the Kaiten console's usage rule, allowance included; one nothing
 * caps has what is used out of "Unlimited", with no percentage or bar to draw; one whose usage could
 * not be read says so, and never claims that nothing was used.
 *
 * It is a block for a page of its own, so it never draws nothing once there is a licence to speak of:
 * a licence with no numeric quota says that in a sentence. It draws nothing only where there is no
 * snapshot to read at all (`mode="public"` and `mode="static"`), as the sections of the portal do.
 *
 * Under `mode="customer-session"` it is the customer's own licence as their portal names it: the
 * plan, and the quotas with the usage the server measured. That portal carries no licence term, so
 * none is drawn. Under `mode="authenticated"` the term is drawn when the licence has one.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function LicenseUsage({ appearance, unstyled = false }: LicenseUsageProps) {
  useAssertWrappedByKaitenProvider("LicenseUsage");
  useTrackComponent("LicenseUsage");

  const merged = useMergedAppearance(appearance);
  const localization = useLocalization();
  const subscriptionWords = useSubscriptionWords();
  const snapshot = useLicensingSnapshot();
  const subscription = useSubscriptionState();
  const titleId = React.useId();
  const usageId = React.useId();

  const data = snapshot.data;
  const quotas = React.useMemo(() => quotasOf(data?.entitlements ?? []), [data?.entitlements]);

  if (snapshot.isLoading) {
    return (
      <div data-slot="license-usage-loading" className="ktn-own" aria-busy="true">
        <Card className={cn(merged.elements?.card)}>
          <CardHeader className={cn(merged.elements?.cardHeader)}>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
          <KaitenBranding className="-mb-6" />
        </Card>
      </div>
    );
  }

  // A read that failed must not look like a licence with no quotas.
  if (snapshot.error && !data) {
    return <SectionError onRetry={snapshot.refetch} appearance={merged} unstyled={unstyled} />;
  }
  // Nobody to speak of: a public catalog or a static one has no customer, so no licence.
  if (!data) return null;

  // A customer session has no licence, only the plan its portal names; a licence says its own name.
  const name = data.license?.name ?? data.currentPlan?.name ?? null;
  const title = name ?? localization.usageMeters.title;
  // In a customer session the subscription is what says a trial; otherwise the licence's own type.
  const trialing = subscription ? subscription.kind === "trial" : data.license?.type === "TRIAL";
  const term = data.licenseTerm ? termSentence(data.licenseTerm, localization) : null;

  if (unstyled) {
    return (
      <section data-slot="license-usage" aria-labelledby={titleId} className="ktn-own">
        <h2 id={titleId} data-slot="license-usage-title" className="ktn-own">
          {title}
        </h2>
        {trialing ? (
          <p data-slot="license-usage-trial" className="ktn-own">
            {subscriptionWords.trial}
          </p>
        ) : null}
        {term ? (
          <p data-slot="license-usage-term" className="ktn-own">
            {term}
          </p>
        ) : null}
        {quotas.length ? (
          <ul
            data-slot="license-usage-quotas"
            aria-label={localization.includedFeatures.usage}
            className="ktn-own"
          >
            {quotas.map((quota) => {
              const { entitlement, reading, unlimited } = quota;
              const window =
                unlimited && !isPeriodicEntitlement(entitlement)
                  ? null
                  : usageWindowLabel(entitlement, localization);
              return (
                <li
                  key={entitlement.slug}
                  data-slot="license-usage-quota"
                  data-usage-state={reading.state ?? undefined}
                  className="ktn-own"
                >
                  {entitlement.name}: {figuresOf(quota, localization)}
                  {window ? ` (${window})` : ""}{" "}
                  <ProvenanceNote
                    unstyled
                    name={entitlement.name}
                    provenance={entitlement.provenance}
                    source={entitlement.effectiveSource ?? entitlement.source}
                  />
                </li>
              );
            })}
          </ul>
        ) : (
          <p data-slot="license-usage-empty" className="ktn-own">
            {localization.billingSummary.noUsage}
          </p>
        )}
      </section>
    );
  }

  return (
    <section data-slot="license-usage" aria-labelledby={titleId} className="ktn-own">
      <Card className={cn(merged.elements?.card)}>
        <CardHeader className={cn(merged.elements?.cardHeader)}>
          <div className="ktn-own flex flex-wrap items-center gap-2">
            <CardTitle
              id={titleId}
              role="heading"
              aria-level={2}
              className={cn(merged.elements?.cardTitle)}
            >
              {title}
            </CardTitle>
            {trialing ? (
              <Badge data-slot="license-usage-trial" variant="secondary" className="ktn-own">
                {subscriptionWords.trial}
              </Badge>
            ) : null}
          </div>
          {term ? (
            <p
              data-slot="license-usage-term"
              className="ktn-own mt-2 text-sm text-ktn-muted-foreground"
            >
              {term}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className={cn("grid gap-3", merged.elements?.cardContent)}>
          {quotas.length ? (
            <>
              <p
                id={usageId}
                data-slot="license-usage-label"
                className="ktn-own font-ktn-mono text-[11px] font-medium text-ktn-muted-foreground uppercase"
              >
                {localization.includedFeatures.usage}
              </p>
              <ul
                data-slot="license-usage-quotas"
                aria-labelledby={usageId}
                className="ktn-own grid gap-4"
              >
                {quotas.map((quota) => {
                  const { entitlement, reading, unlimited, limit } = quota;
                  // A quota whose usage was read, and that something caps, has a bar to fill. Per
                  // row, never per card: each entitlement carries its own cadence (see UsageMeters).
                  const meter = !reading.unavailable && !unlimited;
                  // A quota in its watch band keeps the green badge the meters give it: only the
                  // states that call for a look change it.
                  const badge = getUsageBadge(
                    reading.state === "watch" ? "healthy" : (reading.state ?? "unbounded"),
                  );
                  // "All time" says whether a counter resets, which matters beside a cap and means
                  // nothing beside none. A window that resets still says what the figure counts.
                  const windowLabel =
                    unlimited && !isPeriodicEntitlement(entitlement)
                      ? null
                      : usageWindowLabel(entitlement, localization);

                  return (
                    <li
                      key={entitlement.slug}
                      data-slot="license-usage-quota"
                      data-usage-state={reading.state ?? undefined}
                      className="ktn-own rounded-ktn-lg border border-ktn-border p-4"
                    >
                      <div
                        className={cn("flex items-start justify-between gap-3", meter && "mb-3")}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{entitlement.name}</p>
                          {/* The bar of a capped quota carries these figures in its name, so they are
                            not read out a second time; a row with no bar has only this to say. */}
                          <p
                            data-slot={
                              reading.unavailable ? "license-usage-unavailable" : undefined
                            }
                            aria-hidden={meter ? "true" : undefined}
                            className="ktn-own text-xs text-ktn-muted-foreground"
                          >
                            {figuresOf(quota, localization)}
                          </p>
                          {windowLabel ? (
                            <p className="text-xs text-ktn-muted-foreground">{windowLabel}</p>
                          ) : null}
                          {/* Where the limit comes from, when add-ons or a voucher moved it. */}
                          <ProvenanceNote
                            name={entitlement.name}
                            provenance={entitlement.provenance}
                            source={entitlement.effectiveSource ?? entitlement.source}
                          />
                        </div>
                        {meter ? (
                          <Badge variant={badge.variant} className={badge.className}>
                            {`${reading.percentOfGrant}%`}
                          </Badge>
                        ) : null}
                      </div>
                      {meter ? (
                        <ProgressBar
                          value={reading.used}
                          max={limit}
                          overagePercent={reading.overagePercent}
                          aria-label={`${entitlement.name}: ${reading.used.toLocaleString()} / ${limit.toLocaleString()}`}
                          className={cn(merged.elements?.usageBar)}
                          fillClassName={cn(merged.elements?.usageBarFill)}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <p
              data-slot="license-usage-empty"
              className="ktn-own text-sm text-ktn-muted-foreground"
            >
              {localization.billingSummary.noUsage}
            </p>
          )}
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    </section>
  );
}
