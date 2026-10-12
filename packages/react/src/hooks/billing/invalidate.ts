import type { ScopedMutator } from "swr";

import { kaitenKeys } from "../query-keys.ts";

/** The key of a page of invoices, under the provider scope that read it. */
export const invoicesKey = (scopeKey: string, limit: number) =>
  ["kaiten", scopeKey, "components", "invoices", limit] as const;

/** Reads the portal again, for every component that holds it: what a change just made is in it. */
export function invalidatePortal(mutate: ScopedMutator, scopeKey: string) {
  return mutate(kaitenKeys.components.portal(scopeKey));
}

/** Reads the invoices again, however many pages of them anything holds. */
export function invalidateInvoices(mutate: ScopedMutator, scopeKey: string) {
  return mutate(
    (key) =>
      Array.isArray(key) && key[1] === scopeKey && key[3] === "invoices" && key[2] === "components",
  );
}
