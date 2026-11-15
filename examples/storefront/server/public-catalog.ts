// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the sign-up needs of the public catalogue: which licence a new instance starts on.
//
// `POST /instances` requires a `licenseId`: an instance cannot exist without one. The storefront
// reads the plans it already sells (`GET /public/catalog`, with the publishable key it already
// has), so that the server token does not also need `read:licenses`. Kaiten accepts a publishable
// key on a request that sends no `Origin`, which is what a server's request is.

/** A plan of the public catalogue, as far as a sign-up reads it. */
export interface CataloguePlan {
  /** The id of the licence version the plan sells: what `POST /instances` calls `licenseId`. */
  licenseId: string;
  licenseSlug: string;
  /** `FREE`, `PAID` or `CUSTOM`. */
  pricingType: string;
}

/** Reads the plans on sale. */
export type ReadCatalogue = () => Promise<CataloguePlan[]>;

/** The URL the contract is served under: `/api` is appended when it is not there, as the server SDK does. */
export function apiBase(apiUrl: string): string {
  const url = new URL(apiUrl.trim());
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/api$/, "")}/api`;
  return `${url.origin}${url.pathname}`;
}

/** A reader of the public catalogue, with the publishable key and `fetch` (the global one by default). */
export function catalogueReader(options: {
  apiUrl: string;
  publishableKey: string;
  fetch?: typeof fetch;
}): ReadCatalogue {
  const { apiUrl, publishableKey, fetch: fetchApi = fetch } = options;
  return async () => {
    const response = await fetchApi(`${apiBase(apiUrl)}/public/catalog`, {
      headers: { "X-Kaiten-Publishable-Key": publishableKey, Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`the public catalogue answered ${response.status}`);
    const body = (await response.json()) as { plans?: CataloguePlan[] };
    if (!Array.isArray(body.plans)) throw new Error("the public catalogue has no plans");
    return body.plans;
  };
}

/**
 * The licence a new account's instance starts on: the catalogue's free plan, or `null` when it has none.
 *
 * That is what Kaiten does for its own organizations, whose instance starts on the free Starter version
 * with no subscription, and leaves it through a checkout. The instance then holds free entitlements only,
 * until the visitor pays.
 *
 * It is never a paid plan, and never one that the request names. `POST /instances` requires a licence,
 * and an instance holds the entitlements of the one it starts on: letting a public, unauthenticated
 * route start it on a plan of the caller's choice would give that plan away. Without a free plan there
 * is no sign-up to offer: publish one.
 */
export function licenceForNewAccount(plans: readonly CataloguePlan[]): CataloguePlan | null {
  return plans.find((plan) => plan.pricingType === "FREE") ?? null;
}
