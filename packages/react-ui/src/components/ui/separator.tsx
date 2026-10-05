import * as React from "react";

import { cn } from "../../lib/utils.ts";

export interface SeparatorProps extends React.ComponentProps<"div"> {
  orientation?: "horizontal" | "vertical";
  /** A decorative separator is invisible to assistive technology; a semantic one is announced. */
  decorative?: boolean;
}

/**
 * A rule between two things. The same element and the same ARIA the Radix
 * primitive produced — `role="none"` when decorative, `role="separator"` with
 * an orientation otherwise — written out, since that is all it did.
 */
export function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <div
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      // Horizontal is a separator's implicit orientation; only vertical is stated.
      aria-orientation={!decorative && orientation === "vertical" ? "vertical" : undefined}
      data-orientation={orientation}
      className={cn(
        "ktn-own",
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className,
      )}
      {...props}
    />
  );
}
