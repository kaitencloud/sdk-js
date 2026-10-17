// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// What the snapshot of a customer session says about the customer's plan and
// subscription, read from the portal Kaiten serves: the plan the bound instance is on,
// its subscription (period, interval, cancellation, scheduled change), where an
// entitlement comes from, and what a session bound to the customer only has instead of
// an instance. The portals are the ones Kaiten's own code produced for Initech, held to
// the API contract by the client's tests; the client and the provider are the real ones.

import type { ReactNode } from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenSessionClient, type KaitenSessionClientLike } from "@kaitencloud/client";

import sessionAnswers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };
import acmeCatalog from "../../client/tests/fixtures/public-catalog.acme.json" with { type: "json" };

import {
  Gate,
  KaitenProvider,
  useAddOns,
  useEntitlementCheck,
  useEntitlements,
  useLicense,
  useLicensingSnapshot,
  usePaywallTrigger,
  usePlans,
  usePortal,
  useUpgradeOptions,
} from "../src/index.ts";

const API = "https://kaiten.test/api";
const PK = `pk_${"a".repeat(43)}`;

type PortalName =
  | "portal"
  | "portalCanceling"
  | "portalScheduledChange"
  | "portalPastDue"
  | "portalCustomerWide"
  | "portalNeverSubscribed";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A `fetch` that serves the portal named, and Acme's catalogue, and records every request. */
function stubApi(name: PortalName = "portal") {
  const requests: Request[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/public/session/portal") return json(sessionAnswers[name]);
    if (pathname === "/api/public/catalog") return json(acmeCatalog);
    return json({ code: "Unexpected", status: 404 }, 404);
  });
  vi.stubGlobal("fetch", fetchSpy);
  const sessionClient = new KaitenSessionClient({
    apiUrl: API,
    fetch: fetchSpy,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  const portalReads = () =>
    requests.filter((request) => new URL(request.url).pathname.endsWith("/session/portal"));
  return { sessionClient, requests, portalReads };
}

function wrapperFor(sessionClient: KaitenSessionClientLike) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        publishableKey={PK}
        apiUrl={API}
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    );
  };
}

async function snapshotOf(name: PortalName) {
  const { sessionClient } = stubApi(name);
  const view = renderHook(() => ({ snapshot: useLicensingSnapshot(), portal: usePortal() }), {
    wrapper: wrapperFor(sessionClient),
  });
  await waitFor(() => expect(view.result.current.snapshot.data).toBeDefined());
  return view.result.current;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("names the plan of the bound instance and its subscription, as the portal does", async () => {
  const { snapshot, portal } = await snapshotOf("portal");

  expect(snapshot.data?.currentPlan).toEqual({ slug: "pro-v2", name: "Pro" });
  expect(snapshot.data?.subscription).toMatchObject({
    status: "ACTIVE",
    currentPeriodEnd: "2026-11-01T00:00:00Z",
    billingInterval: "month",
    cancelAtPeriodEnd: false,
    scheduledChange: null,
    basePrice: { id: "00000000-0000-4000-8000-000000000201", amount: 4900 },
  });
  expect(snapshot.data?.subscription?.intervalCount).toBeUndefined();
  // It is the portal's own object, not a copy that could drift from it.
  expect(snapshot.data?.subscription).toBe(portal.data?.subscription);
});

test("a subscription that ends with its period says so", async () => {
  const { snapshot } = await snapshotOf("portalCanceling");

  expect(snapshot.data?.subscription).toMatchObject({
    status: "ACTIVE",
    cancelAtPeriodEnd: true,
    currentPeriodEnd: "2026-11-01T00:00:00Z",
  });
});

test("a plan change scheduled for the next boundary is carried with its price and its date", async () => {
  const { snapshot } = await snapshotOf("portalScheduledChange");

  expect(snapshot.data?.subscription?.scheduledChange).toMatchObject({
    effectiveAt: "2026-11-01T00:00:00Z",
    price: { id: expect.any(String) },
  });
});

test("a quarterly subscription keeps its interval count, and its price is not a monthly one", async () => {
  const { snapshot } = await snapshotOf("portalPastDue");

  expect(snapshot.data?.subscription).toMatchObject({
    status: "PAST_DUE",
    billingInterval: "month",
    intervalCount: 3,
    basePrice: { amount: 13500, interval: "month", intervalCount: 3 },
  });
});

test("an instance that was never subscribed has a plan and no subscription", async () => {
  const { snapshot } = await snapshotOf("portalNeverSubscribed");

  expect(snapshot.data?.currentPlan).toEqual({ slug: "starter-v1", name: "Starter" });
  expect(snapshot.data?.subscription).toBeNull();
});

test("a session bound to the customer only has no plan and no subscription, and lists its instances", async () => {
  const { snapshot, portal } = await snapshotOf("portalCustomerWide");

  expect(snapshot.data?.currentPlan).toBeNull();
  expect(snapshot.data?.subscription).toBeNull();
  expect(portal.data?.instance).toBeNull();
  expect(portal.data?.instances.map((instance) => instance.slug)).toEqual([
    "initech-prod",
    "initech-lab",
  ]);
});

test("a session bound to an instance lists no instances: an empty list, never null", async () => {
  for (const name of ["portal", "portalNeverSubscribed"] as const) {
    cleanup();
    const { portal } = await snapshotOf(name);
    expect(portal.data?.instances, name).toEqual([]);
  }
});

test("a payment method the provider labelled in part has null labels, passed on as they are", async () => {
  const { portal } = await snapshotOf("portalPastDue");

  expect(portal.data?.paymentMethod).toEqual({
    status: "FAILED",
    brand: null,
    last4: null,
    expMonth: null,
    expYear: null,
  });
});

test("an entitlement keeps where it comes from and how: its layer, and the boost on it", async () => {
  const { snapshot } = await snapshotOf("portal");
  const bySlug = (slug: string) =>
    snapshot.data!.entitlements.find((entitlement) => entitlement.slug === slug)!;

  expect(bySlug("api-calls").source).toBe("license");
  expect(bySlug("api-calls").provenance).toMatchObject({
    license: { value: { type: "number", value: 100_000 } },
    addons: [],
    boosts: [{ modifierType: "MULTIPLY", modifierValue: 2, effectiveExpiresAt: null }],
    number: { license: 100_000, boostMultiply: 2, effective: 200_000, unlimited: false },
  });
  expect(bySlug("priority-support").source).toBe("addon");
  expect(bySlug("priority-support").provenance?.license).toBeNull();
  expect(bySlug("priority-support").provenance?.addons).toHaveLength(1);
});

test("one read of the portal serves every hook, and a refetch is one more", async () => {
  const { sessionClient, portalReads, requests } = stubApi("portal");

  function Probe() {
    usePortal();
    useLicensingSnapshot();
    useLicense();
    useEntitlements();
    useAddOns();
    usePlans();
    useUpgradeOptions();
    useEntitlementCheck("api-calls");
    usePaywallTrigger("api-calls");
    return null;
  }
  const Wrapper = wrapperFor(sessionClient);
  const refetch: { current: () => void } = { current: () => {} };
  function Refetcher() {
    refetch.current = usePortal().refetch;
    return null;
  }

  render(
    <Wrapper>
      <Probe />
      <Probe />
      <Gate entitlement="api-calls">{() => <span>gated</span>}</Gate>
      <Refetcher />
    </Wrapper>,
  );
  await screen.findByText("gated");
  await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2));

  expect(portalReads()).toHaveLength(1);
  // The catalogue is read once too, for `usePlans` and the upgrade options.
  expect(requests.filter((request) => request.url.endsWith("/public/catalog"))).toHaveLength(1);

  refetch.current();
  await waitFor(() => expect(portalReads()).toHaveLength(2));
});

test("under another mode the snapshot carries neither", async () => {
  const { createMockKaitenClient, demoSnapshot } = await import("@kaitencloud/client/testing");
  const view = renderHook(() => useLicensingSnapshot(), {
    wrapper: ({ children }) => (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_snapshot"
        customerId="cust-no-plan"
        client={createMockKaitenClient({ snapshot: demoSnapshot() })}
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    ),
  });

  await waitFor(() => expect(view.result.current.data).toBeDefined());
  expect(view.result.current.data?.currentPlan).toBeUndefined();
  expect(view.result.current.data?.subscription).toBeUndefined();
  expect(view.result.current.data?.license).not.toBeNull();
});
