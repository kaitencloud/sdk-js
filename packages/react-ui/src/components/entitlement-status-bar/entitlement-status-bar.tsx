import { memo } from "react";

import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { useIcons } from "../../appearance/icons.tsx";
import {
  useEntitlements,
  isCustomerFacing,
  useLocalization,
  type ResolvedEntitlement,
} from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { ProgressBar } from "../shared/progress-bar.tsx";
import { KaitenLogoIcon } from "../shared/kaiten-logo.tsx";
import { SectionError } from "../shared/section-error.tsx";
import { isUnlimited } from "../shared/unlimited.tsx";
import { getUsageTone, isUsageAtRisk, readQuota, type UsageState } from "../shared/usage-state.ts";
import { Separator } from "../ui/separator.tsx";
import { Skeleton } from "../ui/skeleton.tsx";

/**
 * The quotas a bar can measure.
 *
 * Same rule as `UsageMeters`, and deliberately the same code path: a meter needs a
 * FINITE numeric cap to fill against, and internal counters (`userFacing: false`)
 * are not the customer's business. A bar that showed unlimited grants would render
 * a row of empty tracks that never move.
 */
function meteredEntitlements(entitlements: ResolvedEntitlement[]): ResolvedEntitlement[] {
  return entitlements.filter(
    (entitlement) =>
      isCustomerFacing(entitlement) &&
      entitlement.limitValue.type === "number" &&
      !(entitlement.unlimited ?? isUnlimited(entitlement.limitValue.value)),
  );
}

function numberOf(value: ResolvedEntitlement["currentValue"]): number {
  return value?.type === "number" ? value.value : 0;
}

/**
 * "45k", "4.8k", "1.2M" — the bar gives each meter about 100px, and a spelled-out
 * "100,000 / 250,000" does not fit it in any locale. Compact notation is the only
 * thing that does, and it is what the design specifies. No explicit locale, which
 * matches `toLocaleString()` as used everywhere else in the SDK: the runtime's.
 */
function compact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * The label reads in the colour of the state `ProgressBar` fills with, so the label and the fill
 * never disagree. Only the states that call for a look change it: a healthy or merely watched
 * quota keeps the plain foreground, as it always has.
 *
 * The `-subtle-foreground` variants, NOT `--warning` / `--destructive` themselves.
 * Those two are FILL colours, tuned to carry text on top of them; used as text on a
 * page they fail — `--warning` (#d97706) on white is 3.18:1, which the a11y suite
 * caught here. The subtle pair is the one authored to be read against a surface.
 */
function labelToneFor(state: UsageState | null): string {
  return state !== null && isUsageAtRisk(state) ? getUsageTone(state).text : "text-ktn-foreground";
}

export interface EntitlementStatusBarProps {
  appearance?: KaitenAppearance;
  unstyled?: boolean;
  /**
   * How many meters the bar shows. It is a single row in the host's chrome, not a
   * dashboard — past a handful the meters shrink below the width their numbers
   * need. Extra quotas stay available in `UsageMeters`.
   */
  maxMeters?: number;
  /** Hide the Kaiten mark and wordmark on the left. */
  hideBrand?: boolean;
  /** Rendered as the trailing action when supplied. Omit it and no action shows. */
  onUpgrade?: () => void;
  upgradeText?: string;
}

/** @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path. */
export const EntitlementStatusBar = /* @__PURE__ */ memo(EntitlementStatusBarImpl);

function EntitlementStatusBarImpl({
  appearance,
  unstyled = false,
  maxMeters = 4,
  hideBrand = false,
  onUpgrade,
  upgradeText,
}: EntitlementStatusBarProps) {
  useAssertWrappedByKaitenProvider("EntitlementStatusBar");
  useTrackComponent("EntitlementStatusBar");

  const merged = useMergedAppearance(appearance);
  const entitlements = useEntitlements();
  const localization = useLocalization();
  const icons = useIcons();

  if (entitlements.isLoading) {
    return (
      <div
        data-slot="entitlement-status-bar-loading"
        className="ktn-own flex items-center justify-between gap-6 border-b bg-ktn-popover px-6 py-3"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-28" />
        <div className="flex items-center gap-6">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-8 w-24" />
          ))}
        </div>
      </div>
    );
  }

  const meters = meteredEntitlements(entitlements.data ?? []).slice(0, maxMeters);

  // Same three-way split every other section makes: a failed read must not look
  // like a customer with no quotas.
  if (!meters.length) {
    if (entitlements.error) {
      return (
        <SectionError onRetry={entitlements.refetch} appearance={merged} unstyled={unstyled} />
      );
    }
    return null;
  }

  const label = localization.usageMeters.title;
  const action = upgradeText ?? localization.paywall.upgrade;

  if (unstyled) {
    return (
      <section data-slot="entitlement-status-bar" className="ktn-own" aria-label={label}>
        <ul>
          {meters.map((entitlement) => {
            const used = numberOf(entitlement.currentValue);
            const limit = numberOf(entitlement.limitValue);
            return (
              <li key={entitlement.slug}>
                {entitlement.name}: {used.toLocaleString()} / {limit.toLocaleString()}
              </li>
            );
          })}
        </ul>
        {onUpgrade ? (
          <button type="button" className="ktn-own" onClick={onUpgrade}>
            {action}
          </button>
        ) : null}
      </section>
    );
  }

  const ArrowIcon = icons.arrowUpRight ?? icons.chevronRight;

  return (
    <section
      data-slot="entitlement-status-bar"
      aria-label={label}
      className={cn(
        "ktn-own flex flex-wrap items-center justify-between gap-4 border-b bg-ktn-popover px-6 py-3",
        merged.elements?.card,
      )}
    >
      {hideBrand ? null : (
        <div data-slot="entitlement-status-bar-brand" className="ktn-own flex items-center gap-2">
          {/* The glyph IS the rounded square, so it needs no coloured box behind it —
              `--ktn-primary` rather than the raw brand purple, matching the plan badge. */}
          <KaitenLogoIcon className="size-5 shrink-0 text-ktn-primary" />
          <span className="ktn-own font-ktn-mono text-xs font-bold">KAITEN SDK</span>
        </div>
      )}

      {/*
       * The meters wrap. The bar's outer row already did, but this list did not, so a
       * host wiring more than two quotas — how many is the HOST's call, via
       * `entitlements` — pushed them straight out of the box: 251px past a 320px
       * container with five, measured by the `Crowded` story in tests/layout.
       *
       * `gap-y-3` is smaller than the `gap-6` between meters on a line, because the
       * horizontal gap separates two meters and the vertical one separates two rows of
       * them; matching them made the wrapped bar read as a list rather than a bar.
       */}
      <ul
        data-slot="entitlement-status-bar-meters"
        className="ktn-own flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3"
      >
        {meters.map((entitlement, index) => {
          const reading = readQuota(entitlement);
          const used = numberOf(entitlement.currentValue);
          const limit = numberOf(entitlement.limitValue);

          return (
            <li key={entitlement.slug} className="ktn-own flex items-center gap-6">
              {/*
               * The height goes on a WRAPPER, not on the separator. `Separator` sets
               * `data-[orientation=vertical]:h-full`, and a variant survives `twMerge`
               * alongside a plain `h-8` and then wins — so the divider resolved to 0px
               * against a content-height flex row and simply did not paint.
               */}
              {index > 0 ? (
                <span className="ktn-own flex h-8 shrink-0" aria-hidden="true">
                  <Separator orientation="vertical" />
                </span>
              ) : null}
              <div className="ktn-own flex w-[100px] min-w-0 flex-col gap-1">
                {/* `min-w-0` is what lets the `truncate` below actually truncate: a
                    flex item's floor is its content, so without it the label pushes the
                    row wider instead of ellipsing, and the class does nothing. */}
                <div className="ktn-own flex min-w-0 items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "ktn-own truncate text-xs font-semibold",
                      labelToneFor(reading.state),
                    )}
                    title={entitlement.name}
                  >
                    {entitlement.name}
                  </span>
                  <span className="ktn-own font-ktn-mono text-[11px] text-ktn-muted-foreground">
                    {reading.percentOfGrant}%
                  </span>
                </div>
                {/*
                 * The bar carries the accessible name and the numbers; the caption
                 * under it is the same figures compacted for the eye, so it is
                 * `aria-hidden` rather than read out a second time as "45k/100k".
                 */}
                <ProgressBar
                  value={used}
                  max={limit}
                  overagePercent={reading.overagePercent}
                  className="h-1.5"
                  aria-label={`${entitlement.name}: ${used.toLocaleString()} / ${limit.toLocaleString()}`}
                />
                <span
                  aria-hidden="true"
                  className="ktn-own font-ktn-mono text-[10px] text-ktn-muted-foreground"
                >
                  {compact(used)}/{compact(limit)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {onUpgrade ? (
        <button
          type="button"
          data-slot="entitlement-status-bar-action"
          onClick={onUpgrade}
          className="ktn-own ktn-cta-gradient inline-flex items-center gap-1 rounded-ktn-md px-4 py-2 text-xs font-bold"
        >
          {action}
          {ArrowIcon ? <ArrowIcon className="size-3" aria-hidden="true" /> : null}
        </button>
      ) : null}
    </section>
  );
}
