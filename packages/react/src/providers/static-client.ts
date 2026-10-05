import type { KaitenClientLike } from "@kaitencloud/client";

import type { KaitenCatalog } from "../types.ts";

/**
 * The client a `mode="static"` provider hands its hooks.
 *
 * Static mode is the promise that the SDK makes no request: the host gave it
 * the catalog, fetched wherever the host fetches — a Server Component, a build
 * step, a CMS. But the hooks are written against `KaitenClientLike`, and a few
 * of them can still ask for a live read: `useFeatureFlag` with an evaluation
 * context evaluates over OFREP, `useReportUsage` writes. Rather than making the
 * context's `client` optional and teaching every hook to check, this object
 * answers those asks with the one thing that is true — the catalog it was
 * given — and rejects everything else, naming the mode.
 *
 * A rejection, not a throw: it lands in the hook's `error` like any failed
 * request instead of unmounting the host's tree.
 */
export function createStaticKaitenClient(catalog: KaitenCatalog): KaitenClientLike {
  const unavailable = (operation: string): Promise<never> =>
    Promise.reject(
      new Error(
        `[@kaitencloud/react] ${operation} is not available under mode="static": the provider was ` +
          `given a catalog and no API to call. Use mode="public" for a live catalog, or ` +
          `mode="authenticated" for a customer's snapshot, flags and usage.`,
      ),
    );

  return {
    getCatalog: () => Promise.resolve(catalog),
    getLicensingSnapshot: () => unavailable("getLicensingSnapshot"),
    evaluateFlag: () => unavailable("evaluateFlag"),
    evaluateFlags: () => unavailable("evaluateFlags"),
    reportUsage: () => unavailable("reportUsage"),
  };
}
