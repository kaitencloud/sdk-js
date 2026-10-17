// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useEntitlementCheck } from "../../hooks/use-entitlement-check.ts";
import { useFlags } from "../../hooks/use-kaiten-flags.ts";
import {
  useKaitenDataContext,
  useAssertWrappedByKaitenProvider,
} from "../../providers/kaiten-provider.tsx";

export function KaitenLoaded({ children }: React.PropsWithChildren) {
  useAssertWrappedByKaitenProvider("KaitenLoaded");

  const state = useKaitenDataContext();
  if (state.isLoading || state.error || !state.isLoaded) return null;

  return children;
}

export function KaitenLoading({ children }: React.PropsWithChildren) {
  useAssertWrappedByKaitenProvider("KaitenLoading");

  const state = useKaitenDataContext();
  if (!state.isLoading) return null;

  return children;
}

export interface KaitenFailedRenderProps {
  /**
   * Re-runs the read that failed.
   *
   * The provider sets `shouldRetryOnError: false` deliberately — a licensing
   * outage should not turn every mounted gate into a retry loop against an API
   * that is already struggling. The cost was that nothing retried at all: a
   * failure screen with no way out, where the user's only recourse was to
   * reload the page and lose whatever they were doing.
   */
  retry: () => void;
  /** The error that failed the read, for hosts that want to show or report it. */
  error: Error;
}

export type KaitenFailedProps = {
  /**
   * Static content, or a function receiving `{ retry, error }` to render a
   * failure state the user can act on.
   */
  children: React.ReactNode | ((props: KaitenFailedRenderProps) => React.ReactNode);
};

/**
 * Renders its children when the Kaiten data failed to load.
 *
 * ```tsx
 * <KaitenFailed>
 *   {({ retry }) => <button onClick={retry}>Try again</button>}
 * </KaitenFailed>
 * ```
 */
export function KaitenFailed({ children }: KaitenFailedProps) {
  useAssertWrappedByKaitenProvider("KaitenFailed");

  const state = useKaitenDataContext();
  if (!state.error) return null;

  // A plain node stays a plain node: this is blessed-path surface and every
  // existing `<KaitenFailed><Banner /></KaitenFailed>` must keep working.
  return typeof children === "function"
    ? children({ retry: state.refetch, error: state.error })
    : children;
}

interface ShowCommonProps {
  fallback?: React.ReactNode;
  loading?: React.ReactNode;
  /**
   * Fail policy when the entitlement/flag data can't be loaded. `"block"`
   * (default, fail-closed) renders `fallback` so gated content is never revealed
   * during an outage; `"allow"` (fail-open) renders `children`. Applied
   * regardless of `when`, since the condition can't be evaluated on error.
   */
  onError?: "block" | "allow";
  children: React.ReactNode;
}

/** Entitlement conditions require `entitlement` (and may take `min`); no `flagKey`. */
interface ShowEntitlementProps extends ShowCommonProps {
  when: "entitled" | "not-entitled";
  entitlement: string;
  /** Minimum remaining units required for NUMBER entitlements. */
  min?: number;
  flagKey?: never;
}

/** Flag conditions require `flagKey`; no `entitlement`/`min`. */
interface ShowFlagProps extends ShowCommonProps {
  when: "flag-enabled" | "flag-disabled";
  flagKey: string;
  entitlement?: never;
  min?: never;
}

// A discriminated union so an invalid prop combo (e.g. `when="entitled"`
// without `entitlement`) is a COMPILE error instead of a runtime throw.
export type ShowProps = ShowEntitlementProps | ShowFlagProps;

export function Show({
  when,
  entitlement,
  min,
  flagKey,
  fallback = null,
  loading = null,
  onError = "block",
  children,
}: ShowProps) {
  useAssertWrappedByKaitenProvider("Show");

  const entitlementCheck = useEntitlementCheck(entitlement ?? "", { min });
  const flags = useFlags();
  const flag = flagKey ? flags.data?.find((candidate) => candidate.key === flagKey) : undefined;

  const usesEntitlement = when === "entitled" || when === "not-entitled";
  const isLoading = usesEntitlement ? entitlementCheck.isLoading : flags.isLoading;

  if (isLoading) return <>{loading}</>;

  // A data error can't be resolved into a condition result — apply the fail
  // policy instead of letting `!allowed` accidentally reveal `not-entitled`
  // content (fail-open) during an outage.
  const error = usesEntitlement ? entitlementCheck.error : flags.error;
  if (error) return <>{onError === "allow" ? children : fallback}</>;

  const shouldRender =
    when === "entitled"
      ? entitlementCheck.allowed
      : when === "not-entitled"
        ? !entitlementCheck.allowed
        : when === "flag-enabled"
          ? Boolean(flag?.enabled)
          : !flag?.enabled;

  return <>{shouldRender ? children : fallback}</>;
}
