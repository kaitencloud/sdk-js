// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { useIcons } from "../../appearance/icons.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { usePlans, useLocalization, type Plan } from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { Separator } from "../ui/separator.tsx";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { CardLoading } from "../shared/loading.tsx";
import { SectionError } from "../shared/section-error.tsx";

/**
 * Lifecycle stages a catalog card can flag.
 *
 * The API has no lifecycle field. It does carry entitlement GROUPS, whose slugs
 * arrive on every plan entitlement as `tags` — so a stage is expressed by putting
 * the entitlement in a group named for it, and no schema change is needed to get
 * the badge the design draws. A tag outside this set is left alone: the card shows
 * no stage rather than inventing one.
 */
const STAGES = ["ga", "beta", "alpha", "new", "coming-soon", "deprecated"] as const;
export type FeatureStage = (typeof STAGES)[number];

const STAGE_SET = new Set<string>(STAGES);

/** How each stage paints. `new` has no Badge variant of its own, so it borrows the
 *  warning pair — both halves of which are contrast-audited in the theme. */
const STAGE_STYLE: Record<
  FeatureStage,
  { variant: React.ComponentProps<typeof Badge>["variant"]; className?: string }
> = {
  ga: { variant: "success" },
  beta: { variant: "default" },
  alpha: { variant: "outline" },
  new: {
    variant: "default",
    className: "border-transparent bg-ktn-warning text-ktn-warning-foreground",
  },
  "coming-soon": { variant: "secondary" },
  deprecated: { variant: "outline", className: "text-ktn-muted-foreground" },
};

export interface CatalogFeature {
  slug: string;
  name: string;
  description?: string | null;
  category: string;
  /** Derived from the entitlement's group tags; absent when none names a stage. */
  stage?: FeatureStage;
  /**
   * The provider-namespaced icon token the API carries (e.g. `"lucide:users"`).
   * The SDK does not resolve it — it ships a fixed icon set and will not pull an
   * icon library into a host's bundle to look one up. Pass `renderIcon` to map it
   * against your own set.
   */
  icon?: string | null;
  /** Names of the plans that include this feature, in catalog order. */
  planNames: string[];
}

/**
 * Fold the plan catalog into one row per distinct entitlement, recording which
 * plans grant it. The catalog's shape is "plans, each with entitlements"; this
 * view is the transpose, and nothing upstream provides it.
 */
function buildFeatures(plans: Plan[], generalLabel: string): CatalogFeature[] {
  const features = new Map<string, CatalogFeature>();

  for (const plan of plans) {
    for (const entitlement of plan.entitlements ?? []) {
      // Internal counters are not catalog entries. `undefined` means an older
      // read path did not say, and stays visible — same rule as everywhere else.
      if (entitlement.userFacing === false) continue;

      const existing = features.get(entitlement.slug);
      if (existing) {
        if (!existing.planNames.includes(plan.name)) existing.planNames.push(plan.name);
        continue;
      }

      const stage = (entitlement.tags ?? []).find((tag) => STAGE_SET.has(tag)) as
        | FeatureStage
        | undefined;

      features.set(entitlement.slug, {
        slug: entitlement.slug,
        name: entitlement.name,
        description: entitlement.description,
        category: entitlement.category || generalLabel,
        ...(stage ? { stage } : {}),
        icon: entitlement.icon,
        planNames: [plan.name],
      });
    }
  }

  return [...features.values()];
}

export interface FeatureCatalogProps {
  /** Host-supplied catalog. Omit it and the component reads `usePlans()`. */
  plans?: Plan[];
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  headerText?: string;
  subheaderText?: string;
  /** Show the search field. */
  searchable?: boolean;
  /** Show the category filter row. */
  filterable?: boolean;
  /** Map a feature's `icon` token onto your own icon set. */
  renderIcon?: (feature: CatalogFeature) => React.ReactNode;
  onSelectFeature?: (slug: string, feature: CatalogFeature) => void;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export function FeatureCatalog({
  plans: plansProp,
  appearance,
  unstyled = false,
  headerText,
  subheaderText,
  searchable = true,
  filterable = true,
  renderIcon,
  onSelectFeature,
}: FeatureCatalogProps) {
  useAssertWrappedByKaitenProvider("FeatureCatalog");
  useTrackComponent("FeatureCatalog");

  const merged = useMergedAppearance(appearance);
  const icons = useIcons();
  const localization = useLocalization();
  const plansQuery = usePlans();

  const hostSupplied = plansProp !== undefined;
  const plans = plansProp ?? plansQuery.data ?? [];

  const features = React.useMemo(
    () => buildFeatures(plans, localization.featureComparison.general),
    [localization.featureComparison.general, plans],
  );

  const categories = React.useMemo(() => {
    const seen: string[] = [];
    for (const feature of features) {
      if (!seen.includes(feature.category)) seen.push(feature.category);
    }
    return seen;
  }, [features]);

  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState<string | null>(null);

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return features.filter((feature) => {
      if (category && feature.category !== category) return false;
      if (!needle) return true;
      return (
        feature.name.toLowerCase().includes(needle) ||
        (feature.description ?? "").toLowerCase().includes(needle)
      );
    });
  }, [category, features, query]);

  // Same three-way split as the other catalog-backed components: a failed read
  // must not render as an empty catalog.
  if (!features.length) {
    if (hostSupplied) return null;
    if (plansQuery.error) {
      return <SectionError appearance={merged} unstyled={unstyled} onRetry={plansQuery.refetch} />;
    }
    if (plansQuery.isLoading) {
      return (
        <Card
          className={cn("ktn-own", merged.elements?.card)}
          data-slot="feature-catalog-loading"
          aria-busy="true"
        >
          <CardLoading />
        </Card>
      );
    }
    return null;
  }

  const title = headerText ?? localization.featureCatalog.title;
  const description = subheaderText ?? localization.featureCatalog.description;

  if (unstyled) {
    return (
      <section data-slot="feature-catalog" className="ktn-own" aria-label={title}>
        <h2>{title}</h2>
        <p>{description}</p>
        <ul>
          {features.map((feature) => (
            <li key={feature.slug}>
              {feature.name}
              {feature.stage ? ` (${feature.stage})` : ""} — {feature.category} —{" "}
              {localization.featureCatalog.availableOn} {feature.planNames.join(", ")}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // The catalog has no glyph of its own: the API's `icon` token is provider-namespaced
  // (`lucide:users`) and the SDK ships a fixed set rather than pulling an icon library
  // into a host's bundle to resolve it. One neutral mark for every card, and `renderIcon`
  // for a host that owns the mapping.
  const DefaultIcon = icons.zap;

  return (
    <div
      data-slot="feature-catalog"
      className="ktn-own flex flex-col gap-8 rounded-[1.5rem] border bg-ktn-background p-6 md:p-12"
    >
      {/* Title and search share a line while they fit and stack when they do not —
          a wrapping row, so no query is needed and no window is consulted. `min-w-0`
          lets the heading give ground first; `basis-64 grow` keeps the search field at
          its intended width on a shared line and full-width once it wraps. */}
      <div className="ktn-own flex flex-wrap items-start justify-between gap-4">
        <div className="ktn-own flex min-w-0 flex-col gap-2">
          <h2 className="ktn-own font-ktn-display text-[2rem] leading-tight font-bold">{title}</h2>
          <p className="ktn-own text-sm text-ktn-muted-foreground">{description}</p>
        </div>
        {searchable ? (
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={localization.featureCatalog.search}
            aria-label={localization.featureCatalog.search}
            className="grow basis-64"
          />
        ) : null}
      </div>

      {filterable && categories.length > 1 ? (
        <div
          role="group"
          aria-label={localization.featureCatalog.allCategories}
          className="ktn-own flex flex-wrap items-center gap-2"
        >
          {[null, ...categories].map((value) => {
            const active = category === value;
            return (
              <button
                key={value ?? "__all"}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(value)}
                className={cn(
                  "ktn-own rounded-full border px-4 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-transparent bg-ktn-primary text-ktn-primary-foreground"
                    : "text-ktn-muted-foreground hover:bg-ktn-secondary",
                )}
              >
                {value ?? localization.featureCatalog.allCategories}
              </button>
            );
          })}
        </div>
      ) : null}

      {visible.length ? (
        // Columns from the card's own width, not the window — the same `auto-fit`
        // formula `resolveColumns` documents in pricing-table.tsx, capped at three.
        // A catalog card's min-content is 171px, well under the shared 17rem floor,
        // so the floor here is set by the pricing card it sits beside in the design
        // rather than by this card's own limit.
        <ul className="ktn-own grid gap-5 grid-cols-[repeat(auto-fit,minmax(min(100%,max(17rem,(100%_-_2.5rem)/3)),1fr))]">
          {visible.map((feature) => {
            const stageStyle = feature.stage ? STAGE_STYLE[feature.stage] : undefined;
            const interactive = Boolean(onSelectFeature);

            return (
              <li key={feature.slug} className="ktn-own">
                <Card
                  className={cn(
                    "ktn-own h-full gap-5 rounded-[1rem] py-6",
                    interactive && "cursor-pointer transition-colors hover:border-ktn-primary",
                    merged.elements?.card,
                  )}
                  {...(interactive
                    ? {
                        role: "button",
                        tabIndex: 0,
                        onClick: () => onSelectFeature?.(feature.slug, feature),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectFeature?.(feature.slug, feature);
                          }
                        },
                      }
                    : {})}
                >
                  <CardContent className="ktn-own flex flex-col gap-4">
                    <div className="ktn-own flex items-start justify-between gap-3">
                      <span className="ktn-own flex size-9 shrink-0 items-center justify-center rounded-ktn-md bg-ktn-secondary text-ktn-primary">
                        {renderIcon ? renderIcon(feature) : <DefaultIcon className="size-4" />}
                      </span>
                      {feature.stage && stageStyle ? (
                        <Badge
                          shape="pill"
                          variant={stageStyle.variant}
                          className={stageStyle.className}
                        >
                          {/* The stage is a group SLUG, so it arrives hyphenated. The pill
                              uppercases it in CSS, and "COMING-SOON" reads as a token
                              rather than a label. */}
                          {feature.stage.replace(/-/g, " ")}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="ktn-own flex flex-col gap-1">
                      <h3 className="ktn-own text-base font-semibold">{feature.name}</h3>
                      {feature.description ? (
                        <p className="ktn-own text-sm text-ktn-muted-foreground">
                          {feature.description}
                        </p>
                      ) : null}
                    </div>

                    <Separator className="ktn-own mt-auto" />

                    <div className="ktn-own flex flex-wrap items-center gap-2">
                      <span className="ktn-own font-ktn-mono text-[10px] text-ktn-muted-foreground uppercase">
                        {localization.featureCatalog.availableOn}
                      </span>
                      {feature.planNames.map((planName) => (
                        <span
                          key={planName}
                          className="ktn-own rounded-ktn-sm border px-2 py-1 font-ktn-mono text-[11px]"
                        >
                          {planName}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ktn-own py-8 text-center text-sm text-ktn-muted-foreground">
          {localization.featureCatalog.empty}
        </p>
      )}

      <KaitenBranding />
    </div>
  );
}
