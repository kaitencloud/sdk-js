import { useKaitenContext, useKaitenDataContext } from "../providers/kaiten-provider.tsx";
import { useTrackHook } from "../telemetry/context.tsx";
import type { KaitenPortal, KaitenSessionClientLike } from "../types.ts";
import type { UseKaitenQueryResult } from "./use-kaiten-query.ts";

/**
 * The customer's portal, under `mode="customer-session"`: the subscription, the
 * effective entitlements with their provenance, the add-ons, the vouchers, the
 * payment method, the upcoming invoice and what the customer may do.
 *
 * Under any other mode there is no portal: `data` stays `undefined`, and the
 * read is neither loading nor failed. `refetch` re-reads it, after a change
 * made through the session client for instance.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function usePortal(): UseKaitenQueryResult<KaitenPortal> {
  useTrackHook("usePortal");
  return useKaitenDataContext().portal;
}

/**
 * The customer-session client the provider was given, for the calls a portal or
 * a checkout makes: `checkout`, `cancelSubscription`, `setAddonQuantity`,
 * `listInvoices`… `null` under any mode but `"customer-session"`.
 *
 * Its writes do not refresh the provider's reads on their own: call
 * `usePortal().refetch()` once one succeeds.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useKaitenSessionClient(): KaitenSessionClientLike | null {
  useTrackHook("useKaitenSessionClient");
  return useKaitenContext().sessionClient;
}
