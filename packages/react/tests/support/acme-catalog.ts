// The public catalogue of Acme, as the client maps it.
//
// `public-catalog.acme.json` is what Kaiten serves for `GET /public/catalog`, produced
// by Kaiten's own code and held to the API contract by the client's tests. Reading it
// through the real `KaitenClient` gives the catalogue a host gets, with the prices the
// client splits into `prices` and `billingPrices`, rather than a shape written here.

import { KaitenClient, type KaitenCatalog } from "@kaitencloud/client";

import acmeCatalog from "../../../client/tests/fixtures/public-catalog.acme.json" with { type: "json" };

export const ACME_PUBLISHABLE_KEY = `pk_${"a".repeat(43)}`;

/** The 8 plans of Acme, in the order Kaiten serves them. */
export const ACME_PLAN_SLUGS = acmeCatalog.plans.map((plan) => plan.licenseSlug);

/** A `fetch` that serves `GET /public/catalog` with `body`, and records the requests it saw. */
export function catalogFetch(body: unknown = acmeCatalog, status = 200) {
  const requests: Request[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
    });
  };
  return { fetch, requests };
}

/** The catalogue a host reads with a publishable key: the client's mapping of Acme's. */
export async function mappedAcmeCatalog(): Promise<KaitenCatalog> {
  const { fetch } = catalogFetch();
  const client = new KaitenClient({
    apiUrl: "https://kaiten.test/api",
    authScheme: "publishable",
    tokenProvider: () => ACME_PUBLISHABLE_KEY,
    fetch,
  });
  return client.getCatalog();
}
