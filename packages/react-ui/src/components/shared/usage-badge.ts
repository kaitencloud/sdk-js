import type { UsageState } from "./usage-state.ts";

/** The look of a badge: one of the `Badge` variants and the classes that tune it. */
export interface UsageBadgeLook {
  variant: "success" | "secondary" | "destructive" | "outline";
  className?: string;
}

/**
 * The badge a state wears, as close to the console's status badge as `Badge` allows.
 *
 * A quota that is close to its wall is amber text on the quiet fill; one inside its allowance is
 * outlined in the same amber rather than filled, since the grant is doing what it was bought for and
 * deserves a look, not an alarm; the wall and past it are red. The amber is the `-subtle-foreground`
 * text colour, which is the one authored to be read against a surface.
 */
export function getUsageBadge(state: UsageState): UsageBadgeLook {
  switch (state) {
    case "near_limit":
      return { variant: "secondary", className: "text-warning-subtle-foreground" };
    case "in_allowance":
      return {
        variant: "outline",
        className: "border-warning-subtle-foreground/40 text-warning-subtle-foreground",
      };
    case "at_limit":
    case "over_limit":
      return { variant: "destructive" };
    case "healthy":
      return { variant: "success" };
    default:
      return { variant: "outline" };
  }
}
