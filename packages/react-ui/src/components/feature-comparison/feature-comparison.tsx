import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { useIcons } from "../../appearance/icons.tsx";
import { cn } from "../../lib/utils.ts";
import {
  useLocalization,
  isCustomerFacing,
  usePlans,
  type EntitlementValue,
  type Plan,
  type PlanEntitlement,
} from "@kaitencloud/react";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { CardLoading } from "../shared/loading.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { isUnlimited, UnlimitedValue } from "../shared/unlimited.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";

// Cell values: an explicit entitlement value, "included" (present with no cap
// stated), or "unlimited" — resolved at build time from the server-computed
// flag when present (GraphQL rows), falling back to the value sentinel.
type FeatureCellValue = EntitlementValue | "included" | "unlimited" | null;

interface FeatureRow {
  key: string;
  label: string;
  category: string;
  values: Map<string, FeatureCellValue>;
}

function isUnlimitedGrant(entitlement: PlanEntitlement): boolean {
  return (
    entitlement.unlimited ??
    (entitlement.value?.type === "number" && isUnlimited(entitlement.value.value))
  );
}

function buildFeatureRows(
  plans: Plan[],
  localization: ReturnType<typeof useLocalization>,
): FeatureRow[] {
  const rows = new Map<string, FeatureRow>();

  for (const plan of plans) {
    if (plan.entitlements?.length) {
      for (const entitlement of plan.entitlements) {
        // Internal counters (userFacing=false) never belong on a pricing page.
        if (!isCustomerFacing(entitlement)) continue;
        const key = entitlement.slug || entitlement.name;
        const row = rows.get(key) ?? {
          key,
          label: entitlement.name,
          category: entitlement.category ?? localization.featureComparison.general,
          values: new Map<string, FeatureCellValue>(),
        };

        row.values.set(
          plan.slug,
          isUnlimitedGrant(entitlement)
            ? "unlimited"
            : (entitlement.value ?? inferEntitlementValue(entitlement)),
        );
        rows.set(key, row);
      }
      continue;
    }

    for (const feature of plan.features ?? []) {
      const row = rows.get(feature) ?? {
        key: feature,
        label: feature,
        category: localization.featureComparison.general,
        values: new Map<string, FeatureCellValue>(),
      };
      row.values.set(plan.slug, "included");
      rows.set(feature, row);
    }
  }

  return Array.from(rows.values()).sort((left, right) => {
    if (left.category !== right.category) return left.category.localeCompare(right.category);
    return left.label.localeCompare(right.label);
  });
}

// Called only for entitlements the plan actually lists (so the feature IS
// included), as the fallback when no explicit value is present. It must never
// fabricate a `0` — that reads as "this plan offers zero of the feature", which
// is indistinguishable from a real cap of 0. Presence ⇒ "included".
function inferEntitlementValue(entitlement: PlanEntitlement): EntitlementValue | "included" | null {
  const type = entitlement.type.toLowerCase();

  // A boolean entitlement present in the plan = included.
  if (type === "boolean") {
    return { type: "boolean", value: true };
  }

  // A number entitlement present but with no explicit cap = included with an
  // unspecified limit — render "included", not a fabricated `0`.
  if (type === "number") {
    return "included";
  }

  // Config/other: the explicit value if any, else "included" (it is listed on
  // the plan) rather than "unavailable".
  return entitlement.value ?? "included";
}

/**
 * Names a cell whose only content is an icon.
 *
 * A bare check or cross has an empty accessible name, so "included" and "not
 * available" read identically — the row is unusable without sight, and the
 * comparison table exists precisely to be compared. The label is the same string
 * the unstyled rendering already prints, so the two stay in step. Modelled on
 * `UnlimitedValue`, which has always done this.
 */
function CellIcon({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex items-center">
      {children}
    </span>
  );
}

function formatValue(
  value: FeatureCellValue,
  localization: ReturnType<typeof useLocalization>,
): string {
  if (value === "unlimited") return localization.includedFeatures.unlimited;
  if (value === "included") return localization.featureComparison.included;
  if (!value) return localization.featureComparison.unavailable;
  if (value.type === "boolean") {
    return value.value
      ? localization.featureComparison.included
      : localization.featureComparison.unavailable;
  }
  if (value.type === "number") {
    return value.value.toLocaleString();
  }
  return localization.featureComparison.config;
}

export interface FeatureComparisonProps {
  plans?: Plan[];
  features?: string[];
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export function FeatureComparison({
  plans: plansProp,
  features,
  appearance,
  unstyled = false,
}: FeatureComparisonProps) {
  useAssertWrappedByKaitenProvider("FeatureComparison");
  useTrackComponent("FeatureComparison");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const plansQuery = usePlans();
  const plans = plansProp ?? plansQuery.data ?? [];
  const localization = useLocalization();
  const rows = React.useMemo(() => {
    const builtRows = buildFeatureRows(plans, localization);
    if (!features?.length) return builtRows;

    const wanted = new Set(features);
    return builtRows.filter((row) => wanted.has(row.key) || wanted.has(row.label));
  }, [features, localization, plans]);

  // Same rule as PricingTable: an empty render used to mean both "no plans" and
  // "the catalog failed to load". Only the catalog this component fetched itself
  // can report a state — when the host passes `plans`, it owns the lifecycle.
  if (!plans.length) {
    if (plansProp !== undefined) return null;
    if (plansQuery.error) {
      return <SectionError appearance={merged} unstyled={unstyled} onRetry={plansQuery.refetch} />;
    }
    if (plansQuery.isLoading) {
      return unstyled ? (
        <section data-slot="feature-comparison-loading" className="ktn-own" aria-busy="true">
          <p>{localization.states.loading}</p>
        </section>
      ) : (
        <Card
          className={cn("ktn-own", merged?.elements?.card)}
          data-slot="feature-comparison-loading"
          aria-busy="true"
        >
          <CardLoading />
        </Card>
      );
    }
    return null;
  }

  if (unstyled) {
    return (
      <div data-slot="feature-comparison" className="ktn-own">
        <table>
          <thead>
            <tr>
              <th>{localization.featureComparison.feature}</th>
              {plans.map((plan) => (
                <th key={plan.slug}>{plan.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {plans.map((plan) => (
                  <td key={`${row.key}:${plan.slug}`}>
                    {formatValue(row.values.get(plan.slug) ?? null, localization)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <KaitenBranding unstyled />
      </div>
    );
  }

  const CheckIcon = icons.check;
  const XIcon = icons.x;

  // The design groups the table by category with a full-width band per group,
  // instead of repeating the category under every feature name. Grouping here
  // rather than in `buildFeatureRows` keeps the unstyled rendering — which lists
  // the category per row, and is the stable contract — untouched.
  const groups: { category: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.category === row.category) last.rows.push(row);
    else groups.push({ category: row.category, rows: [row] });
  }

  // The recommended plan's column is emphasised the way its card is in the
  // pricing table: same `--ktn-primary`, so the two components agree on which
  // plan is being pushed.
  const highlightedSlug = plans.find((plan) => plan.highlighted)?.slug;

  return (
    <div data-slot="feature-comparison" className="ktn-own flex flex-col gap-4">
      <Card className={cn(merged.elements?.card)}>
        <CardHeader className={cn("items-center text-center", merged.elements?.cardHeader)}>
          <CardTitle
            className={cn("text-[1.75rem] leading-tight font-bold", merged.elements?.cardTitle)}
          >
            {localization.featureComparison.title}
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("px-0", merged.elements?.featureComparisonTable)}>
          <div className="overflow-x-auto px-6">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="sticky left-0 bg-ktn-card px-4 py-3 text-left font-ktn-mono text-[11px] font-bold text-ktn-muted-foreground uppercase">
                    {localization.featureComparison.feature}
                  </th>
                  {plans.map((plan) => (
                    <th
                      key={plan.slug}
                      className={cn(
                        "px-4 py-3 text-center font-ktn-mono text-[11px] font-bold uppercase",
                        // Same accent tone as the category bands below. `--primary` is
                        // a FILL colour: as 11px bold text on the card it reads 3.53:1
                        // in dark. The checkmarks keep `--primary` — they are icons, so
                        // the 3:1 non-text threshold applies and they clear it.
                        plan.slug === highlightedSlug
                          ? "text-ktn-accent-foreground"
                          : "text-ktn-muted-foreground",
                      )}
                    >
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <React.Fragment key={group.category}>
                    {/* The accent PAIR, not `--primary` on a neutral band. `--primary` is
                        tuned to carry WHITE text as a fill; as text on the muted band it
                        lands at 2.88:1 in dark, which the a11y suite caught. `--accent` /
                        `--accent-foreground` are audited together — 7.72:1 dark, 8.00:1
                        light — and a tinted band is exactly the surface they name. */}
                    <tr className="bg-ktn-accent">
                      <th
                        scope="colgroup"
                        colSpan={plans.length + 1}
                        className="px-4 py-2 text-left font-ktn-mono text-[11px] font-bold text-ktn-accent-foreground uppercase"
                      >
                        {group.category}
                      </th>
                    </tr>
                    {group.rows.map((row, index) => (
                      <tr
                        key={row.key}
                        /* Striping is computed rather than done with an `odd:` variant: the
                       SDK's token-only build emits utilities from a source scan, and a
                       row band that silently compiles to nothing is invisible until a
                       customer sees it. The index is the group's, so every band restarts
                       on the same tone. */
                        className={cn("border-b", index % 2 === 1 && "bg-ktn-muted/40")}
                      >
                        <td className="sticky left-0 bg-inherit px-4 py-3 text-sm font-medium">
                          {row.label}
                        </td>
                        {plans.map((plan) => {
                          const value = row.values.get(plan.slug) ?? null;
                          const isHighlightedColumn = plan.slug === highlightedSlug;
                          return (
                            <td
                              key={`${row.key}:${plan.slug}`}
                              className={cn(
                                "px-4 py-3 text-center text-sm",
                                isHighlightedColumn
                                  ? "font-medium text-ktn-foreground"
                                  : "text-ktn-muted-foreground",
                              )}
                            >
                              {value === "unlimited" ? (
                                <UnlimitedValue />
                              ) : value && value !== "included" && value.type === "boolean" ? (
                                value.value ? (
                                  <CellIcon label={formatValue(value, localization)}>
                                    <CheckIcon
                                      className={cn(
                                        "inline size-4",
                                        isHighlightedColumn
                                          ? "text-ktn-primary"
                                          : "text-ktn-success",
                                      )}
                                    />
                                  </CellIcon>
                                ) : (
                                  <CellIcon label={formatValue(value, localization)}>
                                    <XIcon className="inline size-4 text-ktn-muted-foreground" />
                                  </CellIcon>
                                )
                              ) : value === "included" ? (
                                <CellIcon label={formatValue(value, localization)}>
                                  <CheckIcon
                                    className={cn(
                                      "inline size-4",
                                      isHighlightedColumn ? "text-ktn-primary" : "text-ktn-success",
                                    )}
                                  />
                                </CellIcon>
                              ) : (
                                formatValue(value, localization)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
        <CardFooter className="flex-col items-stretch">
          <KaitenBranding className="-mx-6 -mb-6" />
        </CardFooter>
      </Card>
    </div>
  );
}
