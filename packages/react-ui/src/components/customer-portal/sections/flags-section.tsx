// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";

import { useFlags, useLocalization } from "@kaitencloud/react";
import { useMergedAppearance } from "../../../appearance/context.tsx";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";

export interface FlagsSummaryProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

// Memoized: with the provider's context value now stable, this guards
// against re-renders when the host re-renders the portal subtree with unchanged props.
export const FlagsSummary = /* @__PURE__ */ memo(FlagsSummaryImpl);

function FlagsSummaryImpl({ appearance, unstyled = false }: FlagsSummaryProps) {
  useAssertWrappedByKaitenProvider("FlagsSummary");
  useTrackComponent("FlagsSummary");

  const merged = useMergedAppearance(appearance);
  const flags = useFlags();
  const localization = useLocalization();

  if (flags.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)}>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }

  const data = flags.data ?? [];
  if (flags.error && !data.length) {
    return <SectionError onRetry={flags.refetch} appearance={merged} unstyled={unstyled} />;
  }
  if (!data.length) return null;

  if (unstyled) {
    return (
      <section data-slot="flags-summary" className="ktn-own">
        <h3>{localization.flagsSummary.title}</h3>
        <ul>
          {data.map((flag) => (
            <li key={flag.key}>
              {flag.key}:{" "}
              {flag.enabled
                ? localization.flagsSummary.enabled
                : localization.flagsSummary.disabled}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <Card className={cn(merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn(merged.elements?.cardTitle)}>
          {localization.flagsSummary.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn("grid gap-3", merged.elements?.cardContent)}>
        {data.map((flag) => (
          <div
            key={flag.key}
            // Wrapping row rather than a window-keyed stack→row, for the same reason
            // as the add-on rows: see the note in addons-section.tsx.
            className="flex flex-wrap items-center justify-between gap-2 rounded-ktn-lg border border-ktn-border p-4"
          >
            <div className="min-w-0">
              <h4 className="text-sm font-medium break-words">{flag.key}</h4>
              <p className="text-xs text-ktn-muted-foreground">
                {flag.variant ?? flag.reason ?? localization.flagsSummary.runtimeEvaluation}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {typeof flag.percentage === "number" ? (
                <Badge variant="secondary">
                  {localization.flagsSummary.rollout(flag.percentage)}
                </Badge>
              ) : null}
              <Badge variant={flag.enabled ? "success" : "outline"}>
                {flag.enabled
                  ? localization.flagsSummary.enabled
                  : localization.flagsSummary.disabled}
              </Badge>
            </div>
          </div>
        ))}
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}
