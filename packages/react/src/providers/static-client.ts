import type { KaitenClientLike } from "@kaitencloud/client";

import type { KaitenCatalog } from "../types.ts";

const HINTS = {
  static:
    `the provider was given a catalog and no API to call. Use mode="public" for a live ` +
    `catalog, or mode="authenticated" for a customer's snapshot, flags and usage.`,
  "customer-session": `a customer session reads its portal, and the catalog with a publishableKey.`,
} as const;

/**
 * The client a provider hands its hooks when it has no API to give them.
 *
 * Static mode is the promise that the SDK makes no request: the host gave it
 * the catalog, fetched wherever the host fetches — a Server Component, a build
 * step, a CMS. A customer session without a publishable key has no route but
 * its portal's. But the hooks are written against `KaitenClientLike`, and a few
 * of them can still ask for a live read: `useFeatureFlag` with an evaluation
 * context evaluates over OFREP, `useReportUsage` writes. Rather than making the
 * context's `client` optional and teaching every hook to check, this object
 * answers those asks with the one thing that is true — the catalog it was
 * given, if any — and rejects everything else, naming the mode.
 *
 * A rejection, not a throw: it lands in the hook's `error` like any failed
 * request instead of unmounting the host's tree.
 */
export function createOfflineKaitenClient(
  mode: keyof typeof HINTS,
  catalog?: KaitenCatalog,
): KaitenClientLike {
  const unavailable = (operation: string): Promise<never> =>
    Promise.reject(
      new Error(
        `[@kaitencloud/react] ${operation} is not available under mode="${mode}": ${HINTS[mode]}`,
      ),
    );

  return {
    getCatalog: () => (catalog ? Promise.resolve(catalog) : unavailable("getCatalog")),
    getLicensingSnapshot: () => unavailable("getLicensingSnapshot"),
    evaluateFlag: () => unavailable("evaluateFlag"),
    evaluateFlags: () => unavailable("evaluateFlags"),
    reportUsage: () => unavailable("reportUsage"),
  };
}
