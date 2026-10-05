import { memo } from "react";

import {
  useEntitlements,
  useLocalization,
  isCustomerFacing,
  unitLabel,
  type ResolvedEntitlement,
} from "@kaitencloud/react";
import { useIcons } from "../../../appearance/icons.tsx";
import { useMergedAppearance } from "../../../appearance/context.tsx";
import { cn } from "../../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardHeader, CardTitle } from "../../ui/card.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Skeleton } from "../../ui/skeleton.tsx";
import { KaitenBranding } from "../../shared/kaiten-branding.tsx";
import { SectionError } from "../../shared/section-error.tsx";
import { isUnlimited, UnlimitedValue } from "../../shared/unlimited.tsx";
import type { KaitenAppearance } from "../../../appearance/types.ts";

function renderLimitLabel(
  entitlement: ResolvedEntitlement,
  localization: ReturnType<typeof useLocalization>,
): string {
  if (entitlement.limitValue.type === "boolean") {
    return entitlement.limitValue.value
      ? localization.includedFeatures.enabled
      : localization.includedFeatures.disabled;
  }

  if (entitlement.limitValue.type === "number") {
    if (entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value)) {
      return localization.includedFeatures.unlimited;
    }
    const unit = unitLabel(entitlement, entitlement.limitValue.value);
    const formatted = entitlement.limitValue.value.toLocaleString();
    return unit ? `${formatted} ${unit}` : formatted;
  }

  return entitlement.configLabel ?? localization.includedFeatures.config;
}

function renderUsageLabel(
  entitlement: ResolvedEntitlement,
  localization: ReturnType<typeof useLocalization>,
): string {
  if (entitlement.currentValue?.type === "boolean") {
    return entitlement.currentValue.value
      ? localization.includedFeatures.enabled
      : localization.includedFeatures.disabled;
  }

  if (entitlement.currentValue?.type === "number") {
    return entitlement.currentValue.value.toLocaleString();
  }

  return entitlement.currentValue
    ? localization.includedFeatures.config
    : localization.includedFeatures.unavailable;
}

function statusVariant(
  status: ResolvedEntitlement["status"],
): "default" | "secondary" | "destructive" | "success" | "outline" {
  switch (status) {
    case "over_limit":
      return "destructive";
    case "near_limit":
      return "secondary";
    case "disabled":
      return "outline";
    case "enabled":
    default:
      return "success";
  }
}

function statusLabel(
  entitlement: ResolvedEntitlement,
  localization: ReturnType<typeof useLocalization>,
): string {
  switch (entitlement.status) {
    case "enabled":
      return localization.includedFeatures.enabled;
    case "disabled":
      return localization.includedFeatures.disabled;
    case "near_limit":
      return localization.includedFeatures.nearLimit;
    case "over_limit":
      return localization.includedFeatures.overLimit;
  }

  return localization.includedFeatures.unavailable;
}

export interface IncludedFeaturesProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

// Memoized: guards against host-driven re-renders with unchanged props.
export const IncludedFeatures = /* @__PURE__ */ memo(IncludedFeaturesImpl);

function IncludedFeaturesImpl({ appearance, unstyled = false }: IncludedFeaturesProps) {
  useAssertWrappedByKaitenProvider("IncludedFeatures");
  useTrackComponent("IncludedFeatures");

  const merged = useMergedAppearance(appearance);
  const entitlements = useEntitlements();
  const icons = useIcons();
  const localization = useLocalization();

  if (entitlements.isLoading) {
    return (
      <Card className={cn(merged.elements?.card)}>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
        <KaitenBranding className="-mb-6" />
      </Card>
    );
  }

  // The definition's userFacing flag is the real curation axis: internal
  // counters (userFacing=false) never belong in a customer's plan view. Rows
  // without the flag (REST read path) stay visible.
  const data = (entitlements.data ?? []).filter(isCustomerFacing);
  if (entitlements.error && !data.length) {
    return <SectionError onRetry={entitlements.refetch} appearance={merged} unstyled={unstyled} />;
  }
  if (!data.length) return null;

  if (unstyled) {
    return (
      <section data-slot="included-features" className="ktn-own">
        <h3>{localization.includedFeatures.title}</h3>
        <ul>
          {data.map((entitlement) => (
            <li key={entitlement.slug}>
              {entitlement.name}: {renderUsageLabel(entitlement, localization)} /{" "}
              {renderLimitLabel(entitlement, localization)}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const Icon = icons.zap;

  // IncludedFeatures answers "what does the plan ALLOW" (the catalog of features +
  // their caps + status). Live consumption (current usage + progress bar) is the
  // job of UsageMeters — rendering it here too made the two sections duplicate the
  // same data. So this table is now Feature | Limit | Status, no usage column.
  const isUnlimitedNumber = (entitlement: ResolvedEntitlement) =>
    entitlement.limitValue.type === "number" &&
    (entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value));

  // Uncapped entitlements (the unlimited sentinel) are collapsed behind a
  // disclosure: in real catalogs they are the long tail of "internal"/always-on
  // meters that bury the few headline features. The host can still curate via the
  // `hidden` contract once available; until then the disclosure keeps the table
  // readable without dropping anything.
  const primaryRows = data.filter((entitlement) => !isUnlimitedNumber(entitlement));
  const unlimitedRows = data.filter(isUnlimitedNumber);

  const renderRow = (entitlement: ResolvedEntitlement) => (
    <TableRow
      key={entitlement.slug}
      className={cn(merged.elements?.tableRow)}
      aria-label={localization.includedFeatures.rowSummary(
        entitlement.name,
        renderUsageLabel(entitlement, localization),
        renderLimitLabel(entitlement, localization),
        statusLabel(entitlement, localization),
      )}
    >
      <TableCell className={cn(merged.elements?.tableCell)}>
        <div className="flex flex-col gap-1">
          <span className="font-medium">{entitlement.name}</span>
          {entitlement.category ? (
            <span className="text-xs text-ktn-muted-foreground">{entitlement.category}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={cn(merged.elements?.tableCell)}>
        {isUnlimitedNumber(entitlement) ? (
          <UnlimitedValue />
        ) : (
          renderLimitLabel(entitlement, localization)
        )}
      </TableCell>
      <TableCell className={cn("text-right", merged.elements?.tableCell)}>
        <Badge variant={statusVariant(entitlement.status)}>
          {statusLabel(entitlement, localization)}
        </Badge>
      </TableCell>
    </TableRow>
  );

  // Below `md` the 3-column table becomes a horizontal-scroll wall on phones, so
  // each entitlement renders as a stacked card instead (the SDK embeds on
  // third-party sites — mobile is table-stakes). Same data, no scroll.
  const renderMobileCard = (entitlement: ResolvedEntitlement) => (
    <div
      key={entitlement.slug}
      className="flex items-center justify-between gap-3 rounded-ktn-lg border border-ktn-border p-3"
      aria-label={localization.includedFeatures.rowSummary(
        entitlement.name,
        renderUsageLabel(entitlement, localization),
        renderLimitLabel(entitlement, localization),
        statusLabel(entitlement, localization),
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{entitlement.name}</span>
        <span className="text-xs text-ktn-muted-foreground">
          {entitlement.category ? `${entitlement.category} · ` : ""}
          {localization.includedFeatures.limit}:{" "}
          {isUnlimitedNumber(entitlement)
            ? localization.includedFeatures.unlimited
            : renderLimitLabel(entitlement, localization)}
        </span>
      </div>
      <Badge variant={statusVariant(entitlement.status)}>
        {statusLabel(entitlement, localization)}
      </Badge>
    </div>
  );

  const header = (
    <TableHeader>
      <TableRow className={cn(merged.elements?.tableRow)}>
        <TableHead className={cn(merged.elements?.tableHead)}>
          {localization.includedFeatures.feature}
        </TableHead>
        <TableHead className={cn(merged.elements?.tableHead)}>
          {localization.includedFeatures.limit}
        </TableHead>
        <TableHead className={cn("text-right", merged.elements?.tableHead)}>
          {localization.includedFeatures.status}
        </TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    // `@container/ktn` is what the table↔cards switch below now measures, and it is
    // the ONLY declaration of that container in the SDK today — the classes have a
    // single user. `w-full` travels with it by rule: inline-size containment drops an
    // element's own content from its width calculation, so a container without a
    // definite width collapses as a flex item (see kaiten.css and tests/layout).
    <Card className={cn("@container/ktn w-full", merged.elements?.card)}>
      <CardHeader className={cn(merged.elements?.cardHeader)}>
        <CardTitle className={cn("flex items-center gap-2", merged.elements?.cardTitle)}>
          <Icon className="size-4 text-ktn-primary" />
          {localization.includedFeatures.title}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn(merged.elements?.cardContent)}>
        {/* Wide enough for the table: from 48rem of THIS CARD's width, not the
            window's. Keyed to the window it showed the table inside a 320px slot on
            any desktop browser, which is where CustomerPortal's 125px overflow came
            from — the stacked branch below existed for that case and never ran. */}
        <div className="ktn-only-desktop">
          <Table className={cn(merged.elements?.table)}>
            {header}
            <TableBody>{primaryRows.map(renderRow)}</TableBody>
          </Table>
          {unlimitedRows.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-ktn-muted-foreground">
                {localization.includedFeatures.unlimitedGroup(unlimitedRows.length)}
              </summary>
              <Table className={cn("mt-2", merged.elements?.table)}>
                {header}
                <TableBody>{unlimitedRows.map(renderRow)}</TableBody>
              </Table>
            </details>
          ) : null}
        </div>
        {/* below md : stacked cards (no horizontal scroll) */}
        <div className="ktn-only-mobile">
          {primaryRows.map(renderMobileCard)}
          {unlimitedRows.length ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-ktn-muted-foreground">
                {localization.includedFeatures.unlimitedGroup(unlimitedRows.length)}
              </summary>
              <div className="mt-2 flex flex-col gap-2">{unlimitedRows.map(renderMobileCard)}</div>
            </details>
          ) : null}
        </div>
      </CardContent>
      <KaitenBranding className="-mb-6" />
    </Card>
  );
}

export function EntitlementsSection(props: IncludedFeaturesProps) {
  return <IncludedFeatures {...props} />;
}
