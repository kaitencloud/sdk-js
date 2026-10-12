// @vitest-environment jsdom
//
// What the hooks do with the errors the client throws, and what a gate says about where
// an entitlement comes from. The client and the provider are the real ones, on a stubbed
// `fetch` that answers what Kaiten answers: a read refused for too many calls, a usage
// report refused in each of the ways the client gives a class to.

import type { ReactNode } from "react";
import { cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  KaitenClient,
  KaitenSessionClient,
  type KaitenClientLike,
  type KaitenSessionClientLike,
} from "@kaitencloud/client";
import { demoSnapshot } from "@kaitencloud/client/testing";

import sessionAnswers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

import {
  BoundaryPendingError,
  Gate,
  KaitenError,
  KaitenProvider,
  ProviderUnavailableError,
  QuotaExceededError,
  RateLimitedError,
  useEntitlementCheck,
  useEntitlements,
  usePaywallTrigger,
  usePortal,
  useReportUsage,
} from "../src/index.ts";

const API = "https://kaiten.test/api";

const problem = (
  status: number,
  code: string,
  headers: Record<string, string> = {},
  errors?: unknown,
) =>
  new Response(JSON.stringify({ title: code, status, code, ...(errors ? { errors } : {}) }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });

const portalBody = () => new Response(JSON.stringify(sessionAnswers.portal), { status: 200 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Reads: the portal, refused after it was read once
// ---------------------------------------------------------------------------

/** A session client whose portal is read once, then refused as `refusal` says. */
function sessionClientRefusing(refusal: () => Response) {
  let reads = 0;
  const fetch = vi.fn(async () => (++reads === 1 ? portalBody() : refusal()));
  const sessionClient = new KaitenSessionClient({
    apiUrl: API,
    fetch,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  return { sessionClient, fetch };
}

function sessionWrapper(sessionClient: KaitenSessionClientLike) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        apiUrl={API}
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    );
  };
}

test("a read refused for too many calls keeps what it had, with the class and the delay", async () => {
  const { sessionClient, fetch } = sessionClientRefusing(() =>
    problem(429, "PublicAuth.RateLimited", { "Retry-After": "17" }),
  );
  const { result } = renderHook(
    () => ({ portal: usePortal(), check: useEntitlementCheck("api-calls") }),
    {
      wrapper: sessionWrapper(sessionClient),
    },
  );
  await waitFor(() => expect(result.current.portal.data).toBeDefined());
  expect(result.current.portal.error).toBeNull();
  const first = result.current.portal.data;

  result.current.portal.refetch();
  await waitFor(() => expect(result.current.portal.error).not.toBeNull());

  const { error } = result.current.portal;
  expect(error).toBeInstanceOf(RateLimitedError);
  expect(error).toBeInstanceOf(KaitenError);
  expect(error).toMatchObject({
    status: 429,
    code: "PublicAuth.RateLimited",
    retryAfterSeconds: 17,
  });
  // Nothing was sent again behind the host's back: the read, and the refetch.
  expect(fetch).toHaveBeenCalledTimes(2);
  // The data it had stays, and nothing is loading: a refusal is not a reason to blank a screen.
  expect(result.current.portal).toMatchObject({ data: first, isLoading: false });
  // The entitlement hook says the same error, and still answers from what it read.
  expect(result.current.check.error).toBe(error);
  expect(result.current.check.entitlement?.slug).toBe("api-calls");
  expect(result.current.check.limit).toBe(200_000);
});

test("a read refused with no Retry-After it can read is asked to wait a minute", async () => {
  const { sessionClient } = sessionClientRefusing(() => problem(429, "PublicAuth.RateLimited"));
  const { result } = renderHook(() => usePortal(), { wrapper: sessionWrapper(sessionClient) });
  await waitFor(() => expect(result.current.data).toBeDefined());

  result.current.refetch();
  await waitFor(() => expect(result.current.error).not.toBeNull());

  expect(result.current.error).toBeInstanceOf(RateLimitedError);
  expect((result.current.error as RateLimitedError).retryAfterSeconds).toBe(60);
});

test("the gate is closed on an error unless the host says to allow it, and says which error", async () => {
  const { sessionClient } = sessionClientRefusing(() =>
    problem(429, "PublicAuth.RateLimited", { "Retry-After": "17" }),
  );
  const { result } = renderHook(
    () => ({
      portal: usePortal(),
      blocking: usePaywallTrigger("api-calls"),
      allowing: usePaywallTrigger("api-calls", { onError: "allow" }),
    }),
    { wrapper: sessionWrapper(sessionClient) },
  );
  await waitFor(() => expect(result.current.portal.data).toBeDefined());
  expect(result.current.blocking).toMatchObject({ shouldShow: false, error: null });

  result.current.portal.refetch();
  await waitFor(() => expect(result.current.portal.error).not.toBeNull());

  // Fail-closed by default, as documented: the wall is up with the reason "error" and
  // the API's own error on it, delay included.
  expect(result.current.blocking).toMatchObject({ shouldShow: true, reason: "error" });
  expect(result.current.blocking.error).toBeInstanceOf(RateLimitedError);
  expect((result.current.blocking.error as RateLimitedError).retryAfterSeconds).toBe(17);
  // Opted into fail-open, the same error is there and the wall is not.
  expect(result.current.allowing).toMatchObject({ shouldShow: false, reason: null });
  expect(result.current.allowing.error).toBeInstanceOf(RateLimitedError);
});

// ---------------------------------------------------------------------------
// Usage reports: each class the client has, arriving intact
// ---------------------------------------------------------------------------

const SNAPSHOT = demoSnapshot();

// The SWR cache is global and keyed on the customer: a test gets one of its own.
let customers = 0;
const freshCustomer = () => `acme-${++customers}`;

function reportingWith(reply: () => Response) {
  // The answer is held until the test lets it go, so the gauge can be seen in between.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  const fetch = vi.fn(async () => {
    await held;
    return reply();
  });
  const real = new KaitenClient({ apiUrl: API, authScheme: "none", fetch, timeoutMs: 0 });
  const client: KaitenClientLike = {
    getCatalog: () => real.getCatalog(),
    getLicensingSnapshot: async () => SNAPSHOT,
    evaluateFlag: (...args) => real.evaluateFlag(...args),
    evaluateFlags: (...args) => real.evaluateFlags(...args),
    reportUsage: (...args) => real.reportUsage(...args),
  };
  const customer = freshCustomer();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_report"
      customerId={customer}
      client={client}
      polling={{ enabled: false }}
    >
      {children}
    </KaitenProvider>
  );
  return { fetch, Wrapper, release };
}

const REFUSALS: [string, () => Response, (error: KaitenError) => void][] = [
  [
    "QuotaExceededError",
    () =>
      problem(422, "CreateSessionCheckout.QuotaExceeded", {}, [
        {
          location: "body.licensePriceId",
          message: "usage above the plan",
          value: { entitlementSlugs: ["seats", "api-calls"] },
        },
      ]),
    (error) => {
      expect(error).toBeInstanceOf(QuotaExceededError);
      expect((error as QuotaExceededError).entitlementSlugs).toEqual(["seats", "api-calls"]);
    },
  ],
  [
    "RateLimitedError",
    () => problem(429, "ReportEntitlementUsageMetric.RateLimited", { "Retry-After": "12" }),
    (error) => {
      expect(error).toBeInstanceOf(RateLimitedError);
      expect(error.retryAfterSeconds).toBe(12);
    },
  ],
  [
    "BoundaryPendingError",
    () => problem(409, "SetSessionAddonQuantity.BoundaryPending", { "Retry-After": "60" }),
    (error) => {
      expect(error).toBeInstanceOf(BoundaryPendingError);
      expect(error.retryAfterSeconds).toBe(60);
    },
  ],
  [
    "ProviderUnavailableError",
    () => problem(503, "CreateSessionCheckout.ProviderUnavailable", { "Retry-After": "45" }),
    (error) => {
      expect(error).toBeInstanceOf(ProviderUnavailableError);
      expect(error.retryAfterSeconds).toBe(45);
    },
  ],
];

test.each(REFUSALS)(
  "a usage report refused as %s rejects with it, once, and puts the gauge back",
  async (_name, reply, check) => {
    const onError = vi.fn();
    const { fetch, Wrapper, release } = reportingWith(reply);
    const { result } = renderHook(
      () => ({ report: useReportUsage({ onError }), entitlements: useEntitlements() }),
      { wrapper: Wrapper },
    );
    const gauge = () => {
      const entitlement = result.current.entitlements.data!.find(
        (candidate) => candidate.slug === "api_calls",
      );
      return entitlement?.currentValue?.type === "number" ? entitlement.currentValue.value : NaN;
    };
    await waitFor(() => expect(gauge()).not.toBeNaN());
    const before = gauge();

    // No `transactionId`: the report is sent exactly once, whatever the answer.
    const pending = result.current.report
      .mutateAsync({
        entitlementSlug: "api_calls",
        input: { behavior: "append", value: { type: "number", value: 5 } },
      })
      .catch((error: unknown) => error);

    // While the report is in flight the gauge has moved...
    await waitFor(() => expect(gauge()).toBe(before + 5));
    release();
    const refusal = await pending;

    // ...and once it is refused, the error is the client's own, and the gauge is back.
    expect(refusal).toBeInstanceOf(KaitenError);
    check(refusal as KaitenError);
    await waitFor(() => expect(onError).toHaveBeenCalledWith(refusal));
    expect(fetch).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(gauge()).toBe(before));
  },
);

// ---------------------------------------------------------------------------
// Where an entitlement comes from, in a gate and in a check
// ---------------------------------------------------------------------------

function portalWrapper() {
  const fetch = vi.fn(async () => portalBody());
  const sessionClient = new KaitenSessionClient({
    apiUrl: API,
    fetch,
    getCustomerSession: () => ({
      token: `kst_${"s".repeat(43)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    }),
  });
  return sessionWrapper(sessionClient);
}

test("a gate says which layer grants the entitlement, and how it got its value", async () => {
  const Wrapper = portalWrapper();
  render(
    <Wrapper>
      <Gate entitlement="api-calls">
        {(state) => (
          <span data-testid="gate">
            {state.isLoading
              ? "loading"
              : `${state.source}:${state.provenance?.boosts[0]?.modifierType}:${state.provenance?.number?.effective}`}
          </span>
        )}
      </Gate>
    </Wrapper>,
  );

  await waitFor(() =>
    expect(screen.getByTestId("gate").textContent).toBe("license:MULTIPLY:200000"),
  );
});

test("a check holds the entitlement an add-on grants, which says so and has no licence layer", async () => {
  const Wrapper = portalWrapper();
  const { result } = renderHook(() => useEntitlementCheck("priority-support"), {
    wrapper: Wrapper,
  });

  await waitFor(() => expect(result.current.entitlement).not.toBeNull());
  const { entitlement } = result.current;
  expect(entitlement?.source).toBe("addon");
  expect(entitlement?.provenance?.license).toBeNull();
  expect(entitlement?.provenance?.addons[0]).toMatchObject({
    quantity: 1,
    overrideBehavior: "OVERRIDE",
    value: { type: "boolean", value: true },
  });
});

test("a gate on that entitlement says the same, and one on a slug nothing grants says nothing", async () => {
  const Wrapper = portalWrapper();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const seen: Record<string, string> = {};
  render(
    <Wrapper>
      {["priority-support", "nothing-grants-this"].map((slug) => (
        <Gate key={slug} entitlement={slug}>
          {(state) => {
            if (!state.isLoading) {
              seen[slug] = `${state.source}:${state.provenance?.addons.length}`;
            }
            return null;
          }}
        </Gate>
      ))}
    </Wrapper>,
  );

  await waitFor(() => expect(seen["priority-support"]).toBe("addon:1"));
  expect(seen["nothing-grants-this"]).toBe("undefined:undefined");
  expect(warn).toHaveBeenCalled();
});

test("without a portal there is a source, from the licence, and no provenance", async () => {
  const customer = freshCustomer();
  const { result } = renderHook(() => ({ check: useEntitlementCheck("api_calls") }), {
    wrapper: ({ children }) => (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_origin"
        customerId={customer}
        client={
          {
            getCatalog: async () => ({ plans: [] }),
            getLicensingSnapshot: async () => SNAPSHOT,
            evaluateFlag: async () => ({ key: "k", value: false }),
            evaluateFlags: async () => ({ flags: [] }),
            reportUsage: async () => {
              throw new Error("unused");
            },
          } as unknown as KaitenClientLike
        }
        polling={{ enabled: false }}
      >
        {children}
      </KaitenProvider>
    ),
  });

  await waitFor(() => expect(result.current.check.entitlement).not.toBeNull());
  expect(result.current.check.entitlement?.source).toBe("license");
  expect(result.current.check.entitlement?.provenance).toBeUndefined();
});
