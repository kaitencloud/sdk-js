// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

import {
  useEntitlements,
  useLocalization,
  isCustomerFacing,
  unitLabel,
  usageWindowLabel,
  type ResolvedEntitlement,
} from "@kaitencloud/react";
import { useIcons } from "../../../appearance/icons.tsx";
import { useMergedAppearance } from "../../../appearance/context.tsx";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { ProgressBar } from "../../shared/progress-bar.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import { isUnlimited } from "../../shared/unlimited.tsx";
import { getUsageBadge } from "../../shared/usage-badge.ts";
import { readQuota } from "../../shared/usage-state.ts";
import type { KaitenAppearance } from "../../../appearance/types.ts";
import { ProvenanceNote } from "./provenance-note.tsx";

function meteredEntitlements(entitlements: ResolvedEntitlement[]): ResolvedEntitlement[] {
  // A usage meter needs a FINITE cap to measure against. Drop unlimited (-1)
  // entitlements: they have no progress to show and, in real catalogs, are the
  // long tail of always-on internal counters that buried the few real quotas in
  // an all-∞ wall of cards. The plan's full catalog (incl. unlimited) lives in
  // IncludedFeatures; this section is strictly "quotas you can run out of".
  // Internal counters (userFacing=false) are excluded outright.
  return entitlements.filter(
    (entitlement) =>
      isCustomerFacing(entitlement) &&
      entitlement.limitValue.type === "number" &&
      !(entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value)),
  );
}

export interface UsageMetersProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const UsageMeters = /* @__PURE__ */ memo(UsageMetersImpl);

function UsageMetersImpl({ appearance, unstyled = false }: UsageMetersProps) {
  useAssertWrappedByKaitenProvider("UsageMeters");
  useTrackComponent("UsageMeters");

  const merged = useMergedAppearance(appearance);
  const entitlements = useEntitlements();
  const icons = useIcons();
  const localization = useLocalization();

  if (entitlements.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)}>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }

  const data = meteredEntitlements(entitlements.data ?? []);
  if (entitlements.error && !data.length) {
    return <SectionError onRetry={entitlements.refetch} appearance={merged} unstyled={unstyled} />;
  }
  if (!data.length) return null;

  if (unstyled) {
    return (
      <section data-slot="usage-meters" className="ktn-own">
        <h3>{localization.usageMeters.title}</h3>
        <ul>
          {data.map((entitlement) => {
            const window = usageWindowLabel(entitlement, localization);
            return (
              <li key={entitlement.slug}>
                {entitlement.name}:{" "}
                {entitlement.currentValue?.type === "number" ? entitlement.currentValue.value : 0} /{" "}
                {entitlement.limitValue.type === "number" ? entitlement.limitValue.value : 0}
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
      </section>
    );
  }

  const Icon = icons.alertTriangle;

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn("flex items-center gap-2", merged.elements?.cardTitle)}>
          <Icon className="size-4 text-ktn-primary" />
          {localization.usageMeters.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("grid gap-4", merged.elements?.cardContent)}>
        {data.map((entitlement) => {
          const reading = readQuota(entitlement);
          const current = reading.used;
          const limit = entitlement.limitValue.type === "number" ? entitlement.limitValue.value : 0;
          // A quota in its watch band keeps the badge it has always had: green is what "watch"
          // reads as, and only the states that call for a look change it.
          const badge = getUsageBadge(
            reading.state === "watch" ? "healthy" : (reading.state ?? "unbounded"),
          );
          const windowLabel = usageWindowLabel(entitlement, localization);

          return (
            <div key={entitlement.slug} className="rounded-ktn-lg border border-ktn-border p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{entitlement.name}</p>
                  <p className="text-xs text-ktn-muted-foreground">
                    {`${current.toLocaleString()} / ${limit.toLocaleString()}`}
                    {unitLabel(entitlement, limit) ? ` ${unitLabel(entitlement, limit)}` : ""}
                  </p>
                  {/*
                    Per bar, never once per card. Each entitlement carries its own
                    cadence, and a LICENSE_START anchor phases the window off the
                    instance's own license start date — so two meters on one
                    instance rarely share bounds, and a single caption would be
                    right for at most one of them.
                  */}
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
                <Badge variant={badge.variant} className={badge.className}>
                  {`${reading.percentOfGrant}%`}
                </Badge>
              </div>
              <ProgressBar
                value={current}
                max={limit}
                overagePercent={reading.overagePercent}
                className={cn(merged.elements?.usageBar)}
                fillClassName={cn(merged.elements?.usageBarFill)}
              />
            </div>
          );
        })}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}

export function UsageSection(props: UsageMetersProps) {
  return <UsageMeters {...props} />;
}
