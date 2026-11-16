// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useEntitlementCheck } from "../../hooks/use-entitlement-check.ts";
import {
  useKaitenDataContext,
  useAssertWrappedByKaitenProvider,
} from "../../providers/kaiten-provider.tsx";

/**
 * Renders its children once the Kaiten data is there to decide on.
 *
 * It keeps rendering them when a later read fails: the data that read left is
 * still held, and the provider reads again on its own. It stops only when
 * `KaitenFailed` takes over.
 */
export function KaitenLoaded({ children }: React.PropsWithChildren) {
  useAssertWrappedByKaitenProvider("KaitenLoaded");

  const state = useKaitenDataContext();
  if (!state.isLoaded) return null;

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
   * Re-runs the read that failed, now.
   *
   * The provider reads again on its own, but on a delay that grows to five
   * minutes, so that an outage does not turn every open tab into a retry loop
   * against an API that is already struggling. This is the way out for a user
   * who will not wait for it, short of reloading the page and losing whatever
   * they were doing.
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
 * Renders its children when the Kaiten data failed to load: no read ever
 * succeeded, or reads have been failing for longer than the provider's
 * `staleIfErrorMs`. A read that fails after one that succeeded does not bring
 * it up: `KaitenLoaded` keeps rendering, on the data that read left.
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
  if (!state.failed || !state.error) return null;

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
   * Fail policy when there is no entitlement data to decide on: no read ever
   * succeeded, or reads have been failing for longer than the provider's
   * `staleIfErrorMs`. `"block"` (default, fail-closed) renders `fallback`, so
   * gated content is never revealed to a customer nothing was read for;
   * `"allow"` (fail-open) renders `children`. Applied regardless of `when`,
   * since the condition can't be evaluated without data.
   *
   * A read that fails after one that succeeded is not that case: the condition
   * is evaluated on the data that read left, while the provider reads again.
   */
  onError?: "block" | "allow";
  children: React.ReactNode;
}

/** Entitlement conditions require `entitlement` (and may take `min`). */
interface ShowEntitlementProps extends ShowCommonProps {
  when: "entitled" | "not-entitled";
  entitlement: string;
  /** Minimum remaining units required for NUMBER entitlements. */
  min?: number;
}

// A discriminated union so an invalid prop combo (e.g. `when="entitled"`
// without `entitlement`) is a COMPILE error instead of a runtime throw.
export type ShowProps = ShowEntitlementProps;

export function Show({
  when,
  entitlement,
  min,
  fallback = null,
  loading = null,
  onError = "block",
  children,
}: ShowProps) {
  useAssertWrappedByKaitenProvider("Show");

  const entitlementCheck = useEntitlementCheck(entitlement ?? "", { min });
  // The entitlements come from the read a customer's scope lives on: its
  // `failed` says whether there is anything to decide them on.
  const { failed } = useKaitenDataContext();
  const isLoading = entitlementCheck.isLoading;

  if (isLoading) return <>{loading}</>;

  // An error with nothing to decide on can't be resolved into a condition
  // result — apply the fail policy instead of letting `!allowed` accidentally
  // reveal `not-entitled` content (fail-open) during an outage. An error beside
  // data a read left is decided on that data, below.
  if (entitlementCheck.error && failed) return <>{onError === "allow" ? children : fallback}</>;

  const shouldRender = when === "entitled" ? entitlementCheck.allowed : !entitlementCheck.allowed;

  return <>{shouldRender ? children : fallback}</>;
}
