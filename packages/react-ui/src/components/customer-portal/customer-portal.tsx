import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { useLicensingSnapshot } from "@kaitencloud/react";
import type { KaitenAppearance } from "../../appearance/types.ts";

import { CurrentPlan, type CurrentPlanProps } from "./sections/license-section.tsx";
import { IncludedFeatures, type IncludedFeaturesProps } from "./sections/entitlements-section.tsx";
import { UsageMeters, type UsageMetersProps } from "./sections/usage-section.tsx";
import { AddOns, type AddOnsProps } from "./sections/addons-section.tsx";
import { FlagsSummary, type FlagsSummaryProps } from "./sections/flags-section.tsx";

export type CustomerPortalElement =
  | "CurrentPlan"
  | "IncludedFeatures"
  | "UsageMeters"
  | "AddOns"
  | "FlagsSummary";

// FlagsSummary is intentionally NOT in the defaults: raw feature-flag plumbing
// (keys, variants, rollout %) is operator/developer data, not something an end
// customer should see in a billing portal. It stays exported for ops dashboards
// and can be opted back in via `elements={[..., "FlagsSummary"]}`.
const defaultElements: CustomerPortalElement[] = [
  "CurrentPlan",
  "IncludedFeatures",
  "UsageMeters",
  "AddOns",
];

function resolveElements(elements?: CustomerPortalElement[]): CustomerPortalElement[] {
  return elements?.length ? elements : defaultElements;
}

export interface CustomerPortalProps {
  appearance?: KaitenAppearance;
  elements?: CustomerPortalElement[];
  /**
   * `"two-column"` (default) stacks on mobile and splits into two columns on
   * large screens; `"vertical"` always stacks. (The old `"tabs"` layout was
   * removed — it hid usage/add-ons behind clicks, wrong for a portal.)
   */
  layout?: "vertical" | "two-column";
  unstyled?: boolean;
  onUpgradeVersion?: CurrentPlanProps["onUpgradeVersion"];
  onAddQuota?: CurrentPlanProps["onAddQuota"];
  onAddAddOn?: CurrentPlanProps["onAddAddOn"];
  onManageAddon?: AddOnsProps["onManageAddon"];
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export function CustomerPortal({
  appearance,
  elements,
  layout = "two-column",
  unstyled = false,
  onUpgradeVersion,
  onAddQuota,
  onAddAddOn,
  onManageAddon,
}: CustomerPortalProps) {
  useAssertWrappedByKaitenProvider("CustomerPortal");
  useTrackComponent("CustomerPortal");

  const merged = useMergedAppearance(appearance);
  const snapshot = useLicensingSnapshot();
  const resolvedElements = resolveElements(elements);

  // The whole snapshot failed to load (no stale data to fall back on): render one
  // recoverable error card instead of letting every section blank out silently.
  if (snapshot.error && !snapshot.data) {
    return <SectionError onRetry={snapshot.refetch} appearance={merged} unstyled={unstyled} />;
  }

  const elementComponents: Record<CustomerPortalElement, React.JSX.Element> = {
    CurrentPlan: (
      <CurrentPlan
        appearance={merged}
        unstyled={unstyled}
        onUpgradeVersion={onUpgradeVersion}
        onAddQuota={onAddQuota}
        onAddAddOn={onAddAddOn}
      />
    ),
    IncludedFeatures: <IncludedFeatures appearance={merged} unstyled={unstyled} />,
    UsageMeters: <UsageMeters appearance={merged} unstyled={unstyled} />,
    AddOns: <AddOns appearance={merged} unstyled={unstyled} onManageAddon={onManageAddon} />,
    FlagsSummary: <FlagsSummary appearance={merged} unstyled={unstyled} />,
  };

  if (unstyled) {
    return (
      <div data-slot="customer-portal" className="ktn-own">
        {resolvedElements.map((element) => (
          <div key={element}>{elementComponents[element]}</div>
        ))}
        <KaitenBranding unstyled />
      </div>
    );
  }

  return (
    <div data-slot="customer-portal" className="ktn-own flex flex-col gap-4">
      <div
        className={cn(
          /*
           * `two-column` means "two columns when two columns fit", decided by the
           * portal's own width. It used to be `lg:grid-cols-2`, keyed to the window,
           * which put TWO 152px columns inside a 320px slot on any desktop browser —
           * the root cause of this component's 125px overflow. Every offender the
           * layout suite reported (buttons, prices, add-on descriptions) was downstream
           * of that one class.
           *
           * Same `auto-fit` shape as the card grids, with a 20rem floor rather than
           * 17rem: a portal section carries meters and tables, not a plan card, and
           * needs the extra room before splitting.
           */
          layout === "two-column"
            ? "grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,max(20rem,(100%_-_1rem)/2)),1fr))]"
            : "flex flex-col gap-4",
          merged.elements?.portalGrid,
        )}
      >
        {resolvedElements.map((element) => (
          <div key={element} className={cn(merged.elements?.portalSection)}>
            {elementComponents[element]}
          </div>
        ))}
      </div>
    </div>
  );
}

export type {
  CurrentPlanProps,
  IncludedFeaturesProps,
  UsageMetersProps,
  AddOnsProps,
  FlagsSummaryProps,
};
export { CurrentPlan, IncludedFeatures, UsageMeters, AddOns, FlagsSummary };
