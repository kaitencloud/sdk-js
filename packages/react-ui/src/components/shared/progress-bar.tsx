import type * as React from "react";

import { cn } from "../../lib/utils.ts";

function getBarColor(percentage: number): string {
  if (percentage >= 100) return "bg-ktn-destructive";
  if (percentage >= 80) return "bg-ktn-warning";
  return "bg-ktn-success";
}

export interface ProgressBarProps extends React.ComponentProps<"div"> {
  value: number;
  max: number;
  fillClassName?: string;
}

export function ProgressBar({ value, max, className, fillClassName, ...props }: ProgressBarProps) {
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const accessibleName =
    props["aria-label"] ??
    (props["aria-labelledby"]
      ? undefined
      : `Progress: ${value.toLocaleString()} of ${max.toLocaleString()}`);

  return (
    <div
      data-slot="progress-bar"
      className={cn(
        "ktn-own",
        "h-2 w-full overflow-hidden rounded-full bg-ktn-secondary",
        className,
      )}
      role="progressbar"
      aria-label={accessibleName}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      {...props}
    >
      <div
        data-slot="progress-bar-fill"
        className={cn(
          "ktn-own",
          "h-full rounded-full transition-all duration-300",
          getBarColor(percentage),
          fillClassName,
        )}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
