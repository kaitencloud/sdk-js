// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { useKaitenSessionClient, useLicensingSnapshot, usePortal } from "@kaitencloud/react";
import type { KaitenAppearance } from "../../appearance/types.ts";

import { CurrentPlan, type CurrentPlanProps } from "./sections/license-section.tsx";
import { IncludedFeatures, type IncludedFeaturesProps } from "./sections/entitlements-section.tsx";
import { UsageMeters, type UsageMetersProps } from "./sections/usage-section.tsx";
import { AddOns, type AddOnsProps } from "./sections/addons-section.tsx";
import { FlagsSummary, type FlagsSummaryProps } from "./sections/flags-section.tsx";
import { InvoiceList, type InvoiceListProps } from "./sections/invoices-section.tsx";
import { VoucherEntry, type VoucherEntryProps } from "./sections/voucher-section.tsx";
import {
  PaymentMethodCard,
  type PaymentMethodCardProps,
} from "../payment-method-card/payment-method-card.tsx";

export type CustomerPortalElement =
  | "CurrentPlan"
  | "IncludedFeatures"
  | "UsageMeters"
  | "AddOns"
  | "FlagsSummary"
  | "InvoiceList"
  | "VoucherEntry"
  | "PaymentMethodCard";

/** The elements that only a customer session has anything to say in: the portal's invoices, vouchers and payment method. */
const SESSION_ONLY: CustomerPortalElement[] = ["InvoiceList", "VoucherEntry", "PaymentMethodCard"];

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

// A customer session has more to show than a licence does: how it pays, a voucher to check and its
// invoices, which are the widest and come last.
const sessionDefaultElements: CustomerPortalElement[] = [
  ...defaultElements,
  "PaymentMethodCard",
  "VoucherEntry",
  "InvoiceList",
];

function resolveElements(
  elements: CustomerPortalElement[] | undefined,
  session: boolean,
  capabilities: { invoices: boolean; paymentMethods: boolean } | undefined,
): CustomerPortalElement[] {
  const wanted = elements?.length ? elements : session ? sessionDefaultElements : defaultElements;
  // An element that has nothing to say here leaves no empty cell in the grid, either: the portal
  // drops it, since a cell cannot tell by itself that its content is nothing.
  return wanted.filter(
    (element) =>
      (session || !SESSION_ONLY.includes(element)) &&
      !(element === "InvoiceList" && capabilities?.invoices === false) &&
      !(element === "PaymentMethodCard" && capabilities?.paymentMethods === false),
  );
}

export interface CustomerPortalProps {
  appearance?: KaitenAppearance;
  elements?: CustomerPortalElement[];
  /**
   * `"two-column"` (default) stacks on mobile and splits into two columns on
   * large screens, with one gap between its cards, which are as tall as their row.
   * A section that has nothing to show leaves no cell, and a card left alone in its
   * row takes all of it; `"vertical"` always stacks. (The old `"tabs"` layout was
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
  const session = useKaitenSessionClient() !== null;
  const resolvedElements = resolveElements(elements, session, usePortal().data?.capabilities);

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
        manage={session}
        onUpgradeVersion={onUpgradeVersion}
        onAddQuota={onAddQuota}
        onAddAddOn={onAddAddOn}
      />
    ),
    IncludedFeatures: <IncludedFeatures appearance={merged} unstyled={unstyled} />,
    UsageMeters: <UsageMeters appearance={merged} unstyled={unstyled} />,
    AddOns: <AddOns appearance={merged} unstyled={unstyled} onManageAddon={onManageAddon} />,
    FlagsSummary: <FlagsSummary appearance={merged} unstyled={unstyled} />,
    InvoiceList: <InvoiceList appearance={merged} unstyled={unstyled} />,
    VoucherEntry: <VoucherEntry appearance={merged} unstyled={unstyled} />,
    PaymentMethodCard: <PaymentMethodCard appearance={merged} unstyled={unstyled} />,
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
           * A wrapping row, not a grid. A section that has nothing to say renders
           * nothing, and its cell must leave no trace: in a grid, an empty cell still
           * holds its place, so the card before it sat alone at half width and the
           * next row opened a gap the others did not have. Here the empty cell is
           * `display: none` (see below), the cards that remain flow up, and a card that
           * ends up alone in its row takes all of it. A card basis of half the row, or
           * 20rem when that is more (a portal section carries meters and tables, not a
           * plan card, and needs the room before splitting), is what makes two the most
           * a row holds; one pixel less than the half keeps two of them from wrapping
           * on a rounding. The gap is one value, between rows and between columns.
           */
          layout === "two-column" ? "flex flex-wrap gap-4" : "flex flex-col gap-4",
          merged.elements?.portalGrid,
        )}
      >
        {resolvedElements.map((element) => (
          <div
            key={element}
            className={cn(
              // A section that rendered nothing is an empty cell: not a flex item, so no gap of its own.
              "min-w-0 empty:hidden",
              // Cards in one row share their height: the cell is a column that its card fills, and
              // the branding strip that closes a card sits at its foot.
              layout === "two-column" &&
                "flex max-w-full flex-[1_1_max(20rem,calc((100%_-_1rem)/2_-_1px))] flex-col *:data-[slot=card]:flex-1 [&_[data-slot=kaiten-branding]]:mt-auto",
              // The invoices are the widest thing a portal holds: a row to themselves.
              layout === "two-column" && element === "InvoiceList" && "basis-full",
              merged.elements?.portalSection,
            )}
          >
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
  InvoiceListProps,
  VoucherEntryProps,
  PaymentMethodCardProps,
};
export {
  CurrentPlan,
  IncludedFeatures,
  UsageMeters,
  AddOns,
  FlagsSummary,
  InvoiceList,
  VoucherEntry,
  PaymentMethodCard,
};
