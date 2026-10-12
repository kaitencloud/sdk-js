// The public catalogue of Acme, as Kaiten serves it.
//
// `public-catalog.acme.json` is the body of `GET /public/catalog`, produced by Kaiten's
// own code and held to the API contract by the client's tests. The suites below put
// it behind a stubbed `fetch` and let the real client and the real provider read it, so
// the prices a component draws are the ones the client maps, not a shape written for
// the test. (`packages/react/tests/support/acme-catalog.ts` maps it without a provider.)

import { vi } from "vite-plus/test";

import acmeCatalog from "../../../client/tests/fixtures/public-catalog.acme.json" with { type: "json" };

export { acmeCatalog };

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/**
 * Serves `reply` for `GET /public/catalog` on the global `fetch`, and records the
 * requests. Restore with `vi.unstubAllGlobals()`.
 */
export function stubCatalogApi(reply: Reply | (() => Reply) = {}) {
  const requests: Request[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const {
      status = 200,
      body = acmeCatalog,
      headers = {},
    } = typeof reply === "function" ? reply() : reply;
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": status < 400 ? "application/json" : "application/problem+json",
        ...headers,
      },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return { fetchSpy, requests };
}

/**
 * What Kaiten answers a publishable key used from an origin its owner did not allow:
 * the problem document its own error renderer writes for a 403
 * `PublicAuth.OriginNotAllowed`.
 */
export const originNotAllowed: Reply = {
  status: 403,
  body: {
    type: "https://tools.ietf.org/html/rfc7231#section-6.5.3",
    title: "Forbidden",
    status: 403,
    detail: "this publishable key does not allow requests from this origin",
    instance: "/api/public/catalog",
    code: "PublicAuth.OriginNotAllowed",
  },
};

let keys = 0;

/** A publishable key no other test has used: the SWR cache is global, and keyed on it. */
export function freshPublishableKey(): string {
  keys += 1;
  return `pk_${String(keys).padStart(2, "0")}${"a".repeat(41)}`;
}
