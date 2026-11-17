// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useLicense, useLicensingSnapshot, type LicenseType } from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Badge } from "../ui/badge.tsx";

// Colours the badge by licence type (shared intent with CurrentPlan's badge).
function licenseTypeBadgeVariant(
  type: LicenseType | undefined,
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

export interface PlanBadgeProps {
  unstyled?: boolean;
  className?: string;
}

/**
 * Compact badge of the customer's current plan (name, coloured by licence type). A customer
 * session has no licence: the badge names the plan its portal names, with no type.
 * A small drop-anywhere primitive — e.g. next to an account menu or app header.
 * @experimental
 */
export function PlanBadge({ unstyled = false, className }: PlanBadgeProps) {
  useAssertWrappedByKaitenProvider("PlanBadge");
  useTrackComponent("PlanBadge");

  const license = useLicense();
  const snapshot = useLicensingSnapshot();

  // Same reading as BillingSummary and CurrentPlan: the licence when there is one, else the
  // plan the portal names.
  if (license.isLoading) return null;
  const type = license.data?.type;
  const name = license.data?.name ?? snapshot.data?.currentPlan?.name;
  if (!name) return null;

  if (unstyled) {
    return (
      <span data-slot="plan-badge" className="ktn-own" data-plan-type={type}>
        {name}
      </span>
    );
  }

  return (
    <Badge
      data-slot="plan-badge"
      variant={licenseTypeBadgeVariant(type)}
      className={cn("ktn-own", className)}
    >
      {name}
    </Badge>
  );
}
