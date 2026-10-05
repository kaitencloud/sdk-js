import { useLicense, type LicenseType } from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Badge } from "../ui/badge.tsx";

// Colours the badge by licence type (shared intent with CurrentPlan's badge).
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

export interface PlanBadgeProps {
  unstyled?: boolean;
  className?: string;
}

/**
 * Compact badge of the customer's current plan (name, coloured by licence type).
 * A small drop-anywhere primitive — e.g. next to an account menu or app header.
 * @experimental
 */
export function PlanBadge({ unstyled = false, className }: PlanBadgeProps) {
  useAssertWrappedByKaitenProvider("PlanBadge");
  useTrackComponent("PlanBadge");

  const { data: license, isLoading } = useLicense();

  if (isLoading || !license) return null;

  if (unstyled) {
    return (
      <span data-slot="plan-badge" className="ktn-own" data-plan-type={license.type}>
        {license.name}
      </span>
    );
  }

  return (
    <Badge
      data-slot="plan-badge"
      variant={licenseTypeBadgeVariant(license.type)}
      className={cn("ktn-own", className)}
    >
      {license.name}
    </Badge>
  );
}
