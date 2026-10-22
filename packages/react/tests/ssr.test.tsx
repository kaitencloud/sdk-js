// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment node
//
// Server-rendering tests run WITHOUT jsdom, on purpose.
//
// Under jsdom, `window` exists, so libraries that branch on it at module load
// believe they are in a browser even while `renderToString` runs. SWR is one:
//
//   const IS_SERVER = !isWindowDefined || isLegacyDeno
//   const useIsomorphicLayoutEffect = IS_SERVER ? useEffect : useLayoutEffect
//
// In a jsdom suite that picks `useLayoutEffect`, and React 18 then warns that
// `useLayoutEffect` does nothing on the server — a warning that never fires in a
// real SSR runtime. Asserting "no warnings during SSR" is only meaningful in an
// environment that actually looks like a server, which is what this file is.
//
// The same applies to the transport's browser guard, which keys on `window`:
// only here can a test show that a bearer credential is accepted server-side.

import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenClient } from "@kaitencloud/client";
import { demoCatalog } from "@kaitencloud/client/testing";

import { KaitenProvider, useLocalization, usePlans } from "../src/index.ts";

/** A host's own "Powered by" line, on the strings the provider resolved. */
function BrandingProbe() {
  return <span>{useLocalization().branding.poweredBy}</span>;
}

/** A host's own plan list — what `PricingTable` is, minus the styling. */
function PlansProbe() {
  const plans = usePlans();
  if (plans.isLoading) return <p data-slot="plans-loading" />;
  return (
    <ul data-slot="plans">
      {plans.data
        ?.filter((plan) => plan.published !== false)
        .map((plan) => (
          <li key={plan.slug}>
            {plan.name}
            {plan.entitlements?.length
              ? `: ${plan.entitlements.map((e) => e.name).join(", ")}`
              : ""}
          </li>
        ))}
    </ul>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("KaitenProvider renders deterministic HTML on the server (no React warnings)", async () => {
  const { renderToString } = await import("react-dom/server");
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const html = renderToString(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <BrandingProbe />
    </KaitenProvider>,
  );

  expect(html).toContain("Powered by Kaiten");
  // SSR must not emit React error/warning logs in a happy path render
  expect(errorSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
});

test("a static provider renders the catalog to complete HTML, with no request", async () => {
  const { renderToString } = await import("react-dom/server");
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const catalog = demoCatalog();

  const html = renderToString(
    <KaitenProvider mode="static" catalog={catalog}>
      <PlansProbe />
    </KaitenProvider>,
  );

  // The list, not a loading state: the data is known before the first render,
  // so the server sends the finished page and the client has nothing to fetch.
  expect(html).toContain('data-slot="plans"');
  expect(html).not.toContain('data-slot="plans-loading"');
  for (const plan of catalog.plans) {
    if (plan.published === false) continue;
    expect(html).toContain(plan.name);
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
  expect(warnSpy).not.toHaveBeenCalled();
});

/**
 * What the platform's GraphQL aggregate answers `LicensingCatalog` with — the
 * shape `packages/client/tests/client.test.ts` drives the real `getCatalog()`
 * over. One plan, one grant, its definition attached.
 */
const graphqlCatalogResponse = {
  data: {
    licenses: {
      items: [
        {
          id: "lic-1",
          slug: "pro",
          name: "Pro",
          description: "Pro plan",
          type: "PAID",
          version: "1",
          versionName: null,
          isDefault: true,
          lifecycleState: "PUBLISHED",
          family: { id: "fam-1" },
          entitlements: [
            {
              entitlementSlug: "seats",
              entitlementName: "Seats",
              entitlementType: "NUMBER",
              licenseID: "lic-1",
              licenseSlug: "pro",
              value: { type: "number", value: 10 },
              unlimited: false,
              entitlement: {
                id: "ent-1",
                name: "Seats",
                slug: "seats",
                description: null,
                type: "NUMBER",
                icon: null,
                unitSingular: "seat",
                unitPlural: "seats",
                saleUnitSingular: null,
                saleUnitPlural: null,
                saleUnitFactor: null,
                userFacing: true,
                displayOrder: 1,
                entitlementGroups: [],
              },
            },
          ],
        },
      ],
      hasMore: false,
    },
  },
};

// The README's "Fetching the catalog server-side" recipe, end to end: a Server
// Component (or an Astro page, or a build script) composes the catalog with
// `KaitenClient` and a bearer credential, then hands the plain result to a
// static provider. Runs against the built `@kaitencloud/client`, as a host would.
test("the server-side recipe: KaitenClient composes the catalog in Node, a static provider renders it", async () => {
  const { renderToString } = await import("react-dom/server");
  // The transport refuses a server credential wherever a `window` exists; the
  // recipe holds precisely because a server has none.
  expect(typeof window).toBe("undefined");

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(String(input));
    if (!new URL(request.url).pathname.endsWith("/graphql")) {
      // No REST fallback on offer: if the GraphQL path breaks, this test says so
      // instead of passing on the degraded read.
      return new Response("not found", { status: 404 });
    }
    expect(request.headers.get("Authorization")).toBe("Bearer ksh_server_only");
    return new Response(JSON.stringify(graphqlCatalogResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });

  const kaiten = new KaitenClient({
    apiUrl: "https://api.test/api",
    authScheme: "bearer",
    tokenProvider: () => "ksh_server_only",
    fetch: fetchMock,
  });
  const catalog = await kaiten.getCatalog();

  expect(catalog.plans.map((plan) => plan.slug)).toEqual(["pro"]);
  expect(catalog.plans[0]?.entitlements?.[0]).toMatchObject({ slug: "seats", unitPlural: "seats" });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  const html = renderToString(
    <KaitenProvider mode="static" catalog={catalog}>
      <PlansProbe />
    </KaitenProvider>,
  );

  expect(html).toContain("Pro");
  expect(html).toContain("Seats");
  // Rendering added no request of its own.
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("an anonymous checkout renders on the server: a widget's place, nothing loaded and nothing written", async () => {
  const { renderToString } = await import("react-dom/server");
  const { useAnonymousCheckout } = await import("../src/billing.ts");
  const { createMockKaitenAnonymousCheckoutClient } = await import("@kaitencloud/client/testing");
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const client = createMockKaitenAnonymousCheckoutClient();

  function Signup() {
    const checkout = useAnonymousCheckout({ initial: { priceId: "price_growth_monthly" } });
    return (
      <form data-step={checkout.step} data-available={String(checkout.available)}>
        <div ref={checkout.turnstile.ref} />
        <button disabled={!checkout.canStart}>Continue</button>
      </form>
    );
  }

  const html = renderToString(
    <KaitenProvider
      mode="static"
      catalog={{
        plans: [],
        capabilities: {
          checkout: true,
          paymentMethods: true,
          anonymousCheckout: true,
          turnstileSiteKey: "1x00000000000000000000AA",
        },
      }}
      anonymousCheckoutClient={client}
    >
      <Signup />
    </KaitenProvider>,
  );

  expect(html).toContain('data-step="selecting"');
  expect(html).toContain('data-available="true"');
  expect(html).toContain("disabled");
  // A server draws no widget, loads no script and asks the API for nothing.
  expect(client.calls).toEqual([]);
  expect(errorSpy).not.toHaveBeenCalled();
});
