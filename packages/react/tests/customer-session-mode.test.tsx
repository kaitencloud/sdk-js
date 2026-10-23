// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// `mode="customer-session"`: one customer, through a `kst_` customer session.
//
// These suites run the real `KaitenSessionClient` and `KaitenClient` against a
// stubbed `fetch`, so what they pin is what reaches the wire: the portal read
// with the session as a Bearer token, the catalog read with the publishable key
// and nothing else, and no request at all for what a session cannot do.

import type { ReactNode } from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { KaitenSessionClient, type KaitenSessionClientLike } from "@kaitencloud/client";

// What Kaiten answers, produced by its own code and held to the API contract by the
// client's tests: a session bound to `initech-prod` on Pro, and the public catalog of
// Acme. The suites below pin what the provider does with them, not their shape.
import sessionAnswers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };
import acmeCatalog from "../../client/tests/fixtures/public-catalog.acme.json" with { type: "json" };

import {
  Gate,
  KaitenProvider,
  KaitenScopeProvider,
  useCustomer,
  useEntitlementCheck,
  useFeatureFlag,
  useKaitenScopeKey,
  useKaitenSessionClient,
  useLicense,
  useLicensingSnapshot,
  usePaywallTrigger,
  usePlans,
  usePortal,
  useReportUsage,
  useUpgradeOptions,
  type KaitenPortal,
} from "../src/index.ts";

const API = "https://kaiten.test/api";
const PK = `pk_${"a".repeat(43)}`;

/**
 * `GET /public/session/portal` of a session bound to `initech-prod`, on Pro. A
 * voucher doubles `api-calls`, and the licence allows no overage on it: the effective
 * ceiling is the limit, 200,000.
 */
function portalPayload(apiCallsUsed = 30_000) {
  const portal = structuredClone(sessionAnswers.portal);
  const apiCalls = portal.entitlements.find((entitlement) => entitlement.slug === "api-calls")!;
  apiCalls.currentValue = apiCallsUsed;
  apiCalls.percentageUsed = (apiCallsUsed / 200_000) * 100;
  apiCalls.limitCapExceededOveragePercent = 0;
  apiCalls.maximumAllowedUsage = 200_000;
  return portal;
}

/** `GET /public/catalog`: Starter and Pro, Pro also sold quarterly and half-yearly. */
const CATALOG = {
  ...acmeCatalog,
  plans: acmeCatalog.plans.filter((plan) => ["starter", "pro"].includes(plan.familySlug)),
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A `fetch` that serves the two public routes, and records every request. */
function stubApi(portal: () => unknown = () => portalPayload()) {
  const requests: Request[] = [];
  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    const { pathname } = new URL(request.url);
    if (pathname === "/api/public/session/portal") return json(portal());
    if (pathname === "/api/public/catalog") return json(CATALOG);
    return json({ code: "Unexpected", status: 404 }, 404);
  });
  return { fetchSpy, requests };
}

function sessionClientFor(fetchSpy: typeof fetch) {
  return new KaitenSessionClient({
    apiUrl: API,
    fetch: fetchSpy,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
}

function wrapperFor(sessionClient: KaitenSessionClientLike, publishableKey?: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        publishableKey={publishableKey}
        apiUrl={API}
      >
        {children}
      </KaitenProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("reads the portal with the session, and the catalog with the publishable key, nothing else", async () => {
  const { fetchSpy, requests } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);
  const sessionClient = sessionClientFor(fetchSpy);

  const { result } = renderHook(() => ({ snapshot: useLicensingSnapshot(), plans: usePlans() }), {
    wrapper: wrapperFor(sessionClient, PK),
  });

  await waitFor(() => {
    expect(result.current.snapshot.data).toBeDefined();
    expect(result.current.plans.data).toBeDefined();
  });

  const routes = requests.map((request) => `${request.method} ${new URL(request.url).pathname}`);
  expect(routes.sort()).toEqual(["GET /api/public/catalog", "GET /api/public/session/portal"]);

  const portalRequest = requests.find((request) => request.url.endsWith("/session/portal"))!;
  expect(portalRequest.headers.get("Authorization")).toBe(`Bearer kst_${"s".repeat(43)}`);
  expect(portalRequest.headers.get("X-Kaiten-Publishable-Key")).toBeNull();

  const catalogRequest = requests.find((request) => request.url.endsWith("/public/catalog"))!;
  expect(catalogRequest.headers.get("X-Kaiten-Publishable-Key")).toBe(PK);
  expect(catalogRequest.headers.get("Authorization")).toBeNull();

  expect(result.current.plans.data?.map((plan) => plan.slug)).toEqual(["starter-v1", "pro-v2"]);
});

test("builds the licensing snapshot from the portal, and invents nothing", async () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);

  const { result } = renderHook(
    () => ({ snapshot: useLicensingSnapshot(), license: useLicense(), customer: useCustomer() }),
    { wrapper: wrapperFor(sessionClientFor(fetchSpy), PK) },
  );

  await waitFor(() => expect(result.current.snapshot.data?.plans).toHaveLength(2));
  const snapshot = result.current.snapshot.data!;

  // The commercial half is the portal's, not a hard-coded empty one.
  expect(snapshot.addOns.map((addon) => addon.slug)).toEqual(["extra-seats-v1", "gpu-pack-v1"]);
  expect(snapshot.addOns[0]).toMatchObject({ quantity: 3, maxQuantity: 50 });
  expect(snapshot.credits).toEqual([]);
  expect(snapshot.capabilities).toEqual({
    paymentMethods: true,
    invoices: true,
    unsubscribe: true,
    checkout: false,
  });
  const bySlug = (slug: string) =>
    snapshot.entitlements.find((entitlement) => entitlement.slug === slug);
  expect(bySlug("api-calls")?.source).toBe("license");
  expect(bySlug("priority-support")?.source).toBe("addon");
  expect(bySlug("api-calls")?.provenance?.boosts[0]?.modifierType).toBe("MULTIPLY");
  expect(snapshot.updatedAt).toBe(sessionAnswers.portal.updatedAt);

  // The portal carries none of the ids and audit fields these types require.
  expect(snapshot.customer).toBeNull();
  expect(snapshot.instance).toBeNull();
  expect(snapshot.license).toBeNull();
  expect(snapshot.licenseTerm).toBeNull();
  expect(snapshot.flags).toEqual([]);
  expect(result.current.license.data).toBeUndefined();
  expect(result.current.customer.data).toBeNull();
});

test("usePortal answers what the portal says, and the session client is reachable", async () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);
  const sessionClient = sessionClientFor(fetchSpy);

  const { result } = renderHook(() => ({ portal: usePortal(), client: useKaitenSessionClient() }), {
    wrapper: wrapperFor(sessionClient),
  });

  await waitFor(() => expect(result.current.portal.data).toBeDefined());
  const portal: KaitenPortal = result.current.portal.data!;
  expect(portal.customer.name).toBe("Initech");
  expect(portal.instance?.licenseSlug).toBe("pro-v2");
  expect(portal.subscription).toMatchObject({ status: "ACTIVE", currencyCode: "EUR" });
  expect(portal.paymentMethod).toMatchObject({ brand: "visa", last4: "4242" });
  // A session bound to an instance lists no instances: the answer is empty, never null.
  expect(portal.instances).toEqual([]);
  expect(result.current.client).toBe(sessionClient);
});

test("reads a session bound to the customer only: no instance, its instances listed, no entitlement", async () => {
  const { fetchSpy } = stubApi(() => sessionAnswers.portalCustomerWide);
  vi.stubGlobal("fetch", fetchSpy);

  const { result } = renderHook(
    () => ({
      portal: usePortal(),
      snapshot: useLicensingSnapshot(),
      plans: usePlans(),
      upgrades: useUpgradeOptions(),
    }),
    { wrapper: wrapperFor(sessionClientFor(fetchSpy), PK) },
  );

  await waitFor(() => expect(result.current.plans.data).toBeDefined());
  await waitFor(() => expect(result.current.portal.data).toBeDefined());
  const portal: KaitenPortal = result.current.portal.data!;
  expect(portal.instance).toBeNull();
  expect(portal.instances.map((instance) => instance.slug)).toEqual([
    "initech-prod",
    "initech-lab",
  ]);
  expect(portal.instances[1]!.billingStatus).toBeNull();
  expect(portal.subscription).toBeNull();
  expect(result.current.snapshot.data?.entitlements).toEqual([]);
  // Nothing is bound, so there is no current plan to offer an upgrade from.
  expect(result.current.upgrades.data).toBeUndefined();
});

test("gates on the portal's effective value, not the licence's", async () => {
  // 150,000 used: over the licence's 100,000, under the effective 200,000.
  let used = 150_000;
  const { fetchSpy } = stubApi(() => portalPayload(used));
  vi.stubGlobal("fetch", fetchSpy);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { result } = renderHook(
    () => ({
      check: useEntitlementCheck("api-calls"),
      trigger: usePaywallTrigger("api-calls", 0.9),
      portal: usePortal(),
    }),
    { wrapper: wrapperFor(sessionClientFor(fetchSpy)) },
  );

  await waitFor(() => expect(result.current.check.entitlement).not.toBeNull());
  expect(result.current.check).toMatchObject({ allowed: true, current: 150_000, limit: 200_000 });
  expect(result.current.trigger).toMatchObject({ shouldShow: false, reason: null, metered: true });

  used = 200_000;
  result.current.portal.refetch();
  await waitFor(() => expect(result.current.check.current).toBe(200_000));
  expect(result.current.check.allowed).toBe(false);
  expect(result.current.trigger).toMatchObject({ shouldShow: true, reason: "over_limit" });

  // The mode warning is for scopes without a customer; this one has one.
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("paywall is disabled"));
});

test("Gate renders the feature an add-on grants", async () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);
  const Wrapper = wrapperFor(sessionClientFor(fetchSpy));

  render(
    <Wrapper>
      <Gate entitlement="priority-support">
        {(state) => (
          <span>{state.isLoading ? "loading" : state.allowed ? "support" : "locked"}</span>
        )}
      </Gate>
    </Wrapper>,
  );

  expect(await screen.findByText("support")).toBeTruthy();
  expect(screen.queryByText("locked")).toBeNull();
});

test("without a publishable key there is no catalog, and no catalog request", async () => {
  const { fetchSpy, requests } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);

  const { result } = renderHook(
    () => ({ snapshot: useLicensingSnapshot(), plans: usePlans(), upgrades: useUpgradeOptions() }),
    { wrapper: wrapperFor(sessionClientFor(fetchSpy)) },
  );

  await waitFor(() => expect(result.current.snapshot.data).toBeDefined());
  expect(result.current.plans).toMatchObject({ data: undefined, isLoading: false, error: null });
  expect(result.current.snapshot.data?.plans).toEqual([]);
  expect(result.current.upgrades.data).toBeUndefined();
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/public/session/portal",
  ]);
});

test("offers every published plan but the bound instance's", async () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);

  const { result } = renderHook(() => useUpgradeOptions(), {
    wrapper: wrapperFor(sessionClientFor(fetchSpy), PK),
  });

  await waitFor(() => expect(result.current.data).toBeDefined());
  expect(result.current.data?.map((plan) => plan.slug)).toEqual(["starter-v1"]);
});

test("refuses what a customer session cannot do, before any request", async () => {
  const { fetchSpy, requests } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);

  const { result } = renderHook(
    () => ({
      report: useReportUsage(),
      flag: useFeatureFlag("beta", { plan: "pro" }),
      snapshot: useLicensingSnapshot(),
    }),
    { wrapper: wrapperFor(sessionClientFor(fetchSpy)) },
  );

  await waitFor(() => expect(result.current.snapshot.data).toBeDefined());
  await expect(
    result.current.report.mutateAsync({
      entitlementSlug: "api-calls",
      input: { value: { type: "number", value: 1 }, behavior: "append", transactionId: "t-1" },
    }),
  ).rejects.toThrow(/only available in authenticated mode, not under mode="customer-session"/);

  await waitFor(() => expect(result.current.flag.error).not.toBeNull());
  expect(result.current.flag.error?.message).toContain('mode="customer-session"');

  // The portal read, and nothing the session is not for.
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/public/session/portal",
  ]);
});

test("renders a portal the server already read on the first render, with no request", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const unused = () => Promise.reject(new Error("not called"));
  const sessionClient: KaitenSessionClientLike = {
    getPortal: vi.fn(unused),
    listInvoices: unused,
    checkout: unused,
    cancelSubscription: unused,
    reactivateSubscription: unused,
    createPortalSession: unused,
    createPaymentMethodSession: unused,
    completePaymentMethodSession: unused,
    validateVoucher: unused,
    redeemVoucher: unused,
    setAddonQuantity: unused,
  };
  const serverPortal: KaitenPortal = {
    customer: { slug: "initech", name: "Initech", billingEmail: null },
    instance: null,
    instances: [],
    subscription: null,
    entitlements: [],
    addOns: [],
    vouchers: [],
    paymentMethod: null,
    upcomingInvoice: null,
    capabilities: { paymentMethods: false, invoices: true, unsubscribe: false, checkout: false },
    updatedAt: "2026-10-06T10:00:00.000Z",
  };

  const { result } = renderHook(() => usePortal(), {
    wrapper: ({ children }) => (
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        initialData={{ portal: serverPortal }}
      >
        {children}
      </KaitenProvider>
    ),
  });

  expect(result.current).toMatchObject({ isLoading: false, error: null });
  expect(result.current.data?.customer.name).toBe("Initech");
  expect(sessionClient.getPortal).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("each session client is its own scope", () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);
  const first = sessionClientFor(fetchSpy);
  const second = sessionClientFor(fetchSpy);

  const keyOf = (client: KaitenSessionClientLike) =>
    renderHook(() => useKaitenScopeKey(), { wrapper: wrapperFor(client) }).result.current;

  expect(keyOf(first)).toBe(keyOf(first));
  expect(keyOf(first)).not.toBe(keyOf(second));
  expect(keyOf(first)).toMatch(/^customer-session:/);
});

test("KaitenScopeProvider moves from the public catalog to the customer's session", async () => {
  const { fetchSpy } = stubApi();
  vi.stubGlobal("fetch", fetchSpy);
  const sessionClient = sessionClientFor(fetchSpy);
  const publicConfig = { mode: "public" as const, publishableKey: PK, apiUrl: API };
  const sessionConfig = {
    mode: "customer-session" as const,
    sessionClient,
    publishableKey: PK,
    apiUrl: API,
  };

  function Probe() {
    const portal = usePortal();
    const plans = usePlans();
    return (
      <span data-testid="probe">
        {plans.data?.length ?? "-"}:{portal.data?.customer.name ?? "signed out"}
      </span>
    );
  }

  const { rerender } = render(
    <KaitenScopeProvider publicConfig={publicConfig} authenticatedConfig={null}>
      <Probe />
    </KaitenScopeProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("2:signed out"));

  rerender(
    <KaitenScopeProvider publicConfig={publicConfig} authenticatedConfig={sessionConfig}>
      <Probe />
    </KaitenScopeProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("2:Initech"));
});
