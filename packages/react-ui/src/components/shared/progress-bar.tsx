// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type * as React from "react";

import { cn } from "../../lib/utils.ts";
import { getUsageCeiling, getUsageState, getUsageTone } from "./usage-state.ts";

/**
 * The allowance, drawn on the track even while unused so a soft limit shows before anyone reaches
 * it. Hatched in the warning colour, which is also the colour usage takes once it is inside.
 */
const ALLOWANCE_BAND =
  "repeating-linear-gradient(135deg, color-mix(in srgb, var(--ktn-warning) 45%, transparent) 0 3px, transparent 3px 7px)";

/** `part` as a percentage of `whole`, kept on the track. Any usage of a whole of nothing fills it. */
function share(part: number, whole: number): number {
  if (whole === 0) {
    return part > 0 ? 100 : 0;
  }
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

export interface ProgressBarProps extends React.ComponentProps<"div"> {
  /** What was consumed. */
  value: number;
  /** The granted value: where what was bought runs out. */
  max: number;
  /**
   * The allowance the grant tolerates, as a percentage of `max`. Without it the grant is a hard
   * limit and `max` is the end of the track.
   */
  overagePercent?: number | null;
  fillClassName?: string;
}

/**
 * A quota against its grant, the way the grant enforces it, and the same meter the Kaiten console
 * draws. The track runs from nothing to the most the API accepts. When the grant tolerates an
 * allowance, a hatched band covers it and a tick marks the granted value; when it tolerates none,
 * the granted value is the end of the track and needs no mark.
 *
 * The part of the fill up to the grant is the state's colour, except inside the allowance, where it
 * stays green: what was bought is not in trouble, the overage is. Usage past the grant fills the band
 * in the state's colour. The state is on the root as `data-usage-state`.
 *
 * Accessible as a progress bar whose maximum is the ceiling, so a screen reader hears the same
 * track the eye sees. Pass `aria-label` or `aria-labelledby` to name it; it has a default otherwise.
 */
export function ProgressBar({
  value,
  max,
  overagePercent,
  className,
  fillClassName,
  ...props
}: ProgressBarProps) {
  const ceiling = getUsageCeiling(max, overagePercent);
  const state = getUsageState(value, max, overagePercent);
  const tone = getUsageTone(state);
  // Room past the grant. Not `overagePercent > 0` alone: a grant of nothing has an allowance of
  // nothing, so there is no band to draw.
  const hasAllowance = ceiling !== null && ceiling > max;
  const grant = hasAllowance ? share(max, ceiling) : 100;
  const used = ceiling === null ? 0 : share(value, ceiling);
  const contract = Math.min(used, grant);
  const allowance = Math.max(0, used - grant);
  const contractFill = state === "in_allowance" ? getUsageTone("healthy").fill : tone.fill;
  const accessibleName =
    props["aria-label"] ??
    (props["aria-labelledby"]
      ? undefined
      : `Progress: ${value.toLocaleString()} of ${max.toLocaleString()}`);

  return (
    <div
      data-slot="progress-bar"
      data-usage-state={state}
      className={cn(
        "ktn-own",
        "relative h-2 w-full overflow-hidden rounded-full bg-ktn-secondary",
        className,
      )}
      role="progressbar"
      aria-label={accessibleName}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={ceiling ?? max}
      {...props}
    >
      {hasAllowance ? (
        <div
          data-segment="band"
          className="ktn-own absolute inset-y-0 right-0"
          style={{ backgroundImage: ALLOWANCE_BAND, left: `${grant}%` }}
        />
      ) : null}
      <div
        data-slot="progress-bar-fill"
        data-segment="contract"
        className={cn(
          "ktn-own",
          "absolute inset-y-0 left-0 transition-all duration-300",
          hasAllowance ? "" : "rounded-full",
          contractFill,
          fillClassName,
        )}
        style={{ width: `${contract}%` }}
      />
      {allowance > 0 ? (
        <div
          data-segment="allowance"
          className={cn("ktn-own absolute inset-y-0 transition-all duration-300", tone.fill)}
          style={{ left: `${grant}%`, width: `${allowance}%` }}
        />
      ) : null}
      {/* The granted value: where what was bought runs out. */}
      {hasAllowance ? (
        <div
          data-segment="grant"
          className="ktn-own absolute inset-y-0 w-px bg-ktn-foreground/70"
          style={{ left: `calc(${grant}% - 0.5px)` }}
        />
      ) : null}
    </div>
  );
}
