import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError, KaitenSessionClient } from "../src/index.ts";
import type {
  KaitenClientLike,
  KaitenCustomerSession,
  KaitenSessionClientLike,
} from "../src/index.ts";

const T0 = Date.parse("2026-10-06T10:00:00.000Z");
const MINUTE = 60_000;
const KST_A = `kst_${"A".repeat(43)}`;
const KST_B = `kst_${"B".repeat(43)}`;

const PORTAL = {
  customer: { slug: "initech", name: "Initech", billingEmail: "ap@initech.test" },
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": status < 400 ? "application/json" : "application/problem+json" },
  });
}

/** A fetch double recording every request; `reply` decides each answer. */
function server(reply: (request: Request, index: number) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    requests.push(request);
    return reply(request, requests.length - 1);
  });
  return { fetch, requests };
}

/** A host callback handing out the queued sessions, the last one repeating. */
function sessions(...queued: KaitenCustomerSession[]) {
  let call = 0;
  return vi.fn(async () => queued[Math.min(call++, queued.length - 1)]!);
}

const session = (token: string, expiresAt: number): KaitenCustomerSession => ({
  token,
  expiresAt: new Date(expiresAt).toISOString(),
});

function sessionClient(
  fetch: (input: RequestInfo | URL) => Promise<Response>,
  getCustomerSession: () => Promise<KaitenCustomerSession>,
  onAuthError = vi.fn(),
) {
  return new KaitenSessionClient({
    apiUrl: "https://api.acme.test/api",
    fetch,
    getCustomerSession,
    onAuthError,
  });
}

beforeEach(() => {
  // Only the clock: the client's own timers (retry delays, timeouts) stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session mode: Bearer kst_ on session routes only, refreshed before expiry", () => {
  test("the session is sent, kept while it has more than a minute left, renewed once after", async () => {
    const { fetch, requests } = server(() => json(PORTAL));
    const getCustomerSession = sessions(
      session(KST_A, T0 + 30 * MINUTE),
      session(KST_B, T0 + 60 * MINUTE),
    );
    const client = sessionClient(fetch, getCustomerSession);

    await client.getPortal();
    expect(requests[0]!.url).toBe("https://api.acme.test/api/public/session/portal");
    expect(requests[0]!.headers.get("Authorization")).toBe(`Bearer ${KST_A}`);
    expect(requests[0]!.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
    expect(requests[0]!.credentials).toBe("omit");

    // 61 s before expiry: still the held session, and the host is not asked.
    vi.setSystemTime(T0 + 30 * MINUTE - 61_000);
    await client.getPortal();
    expect(requests[1]!.headers.get("Authorization")).toBe(`Bearer ${KST_A}`);
    expect(getCustomerSession).toHaveBeenCalledTimes(1);

    // 59 s before expiry: two concurrent calls share one renewal.
    vi.setSystemTime(T0 + 30 * MINUTE - 59_000);
    await Promise.all([client.getPortal(), client.listInvoices()]);
    expect(getCustomerSession).toHaveBeenCalledTimes(2);
    expect(requests[2]!.headers.get("Authorization")).toBe(`Bearer ${KST_B}`);
    expect(requests[3]!.headers.get("Authorization")).toBe(`Bearer ${KST_B}`);
  });

  test("the session client has no call outside the session routes, so no kst_ leaves for one", () => {
    const client = sessionClient(
      server(() => json(PORTAL)).fetch,
      sessions(session(KST_A, T0 + 30 * MINUTE)),
    );

    // @ts-expect-error -- usage reports are the vendor's backend's, never a session's.
    expect(client.reportUsage).toBeUndefined();
    // @ts-expect-error -- the licensing snapshot reads private routes.
    expect(client.getLicensingSnapshot).toBeUndefined();
  });

  test("a publishable key and a session travel separately, each to its own routes", async () => {
    const { fetch, requests } = server((request) =>
      new URL(request.url).pathname.endsWith("/catalog")
        ? json({ plans: [], addOns: [], capabilities: {} })
        : json(PORTAL),
    );
    const catalog = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "publishable",
      tokenProvider: () => `pk_${"a".repeat(43)}`,
      fetch,
    });
    const portal = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

    await catalog.getCatalog();
    await portal.getPortal();

    expect(requests[0]!.headers.get("Authorization")).toBeNull();
    expect(requests[0]!.headers.get("X-Kaiten-Publishable-Key")).toMatch(/^pk_/);
    expect(requests[1]!.headers.get("Authorization")).toBe(`Bearer ${KST_A}`);
    expect(requests[1]!.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
  });

  test("a 401 renews the session and retries once; a second 401 reaches onAuthError", async () => {
    const invalid = () =>
      json({ title: "Unauthorized", status: 401, code: "PublicAuth.InvalidCredential" }, 401);

    const once = server((_request, index) => (index === 0 ? invalid() : json(PORTAL)));
    const onAuthError = vi.fn();
    await sessionClient(
      once.fetch,
      sessions(session(KST_A, T0 + 30 * MINUTE), session(KST_B, T0 + 30 * MINUTE)),
      onAuthError,
    ).getPortal();
    expect(once.requests.map((request) => request.headers.get("Authorization"))).toEqual([
      `Bearer ${KST_A}`,
      `Bearer ${KST_B}`,
    ]);
    expect(onAuthError).not.toHaveBeenCalled();

    const always = server(() => invalid());
    const refused = vi.fn();
    const client = sessionClient(
      always.fetch,
      sessions(session(KST_A, T0 + 30 * MINUTE), session(KST_B, T0 + 30 * MINUTE)),
      refused,
    );
    await expect(client.getPortal()).rejects.toMatchObject({
      status: 401,
      code: "PublicAuth.InvalidCredential",
    });
    expect(always.requests).toHaveLength(2);
    expect(refused).toHaveBeenCalledTimes(1);
    expect(refused.mock.calls[0]![0]).toMatchObject({ status: 401, operation: "getPortal()" });
  });

  test("a session client needs getCustomerSession", () => {
    expect(() => new KaitenSessionClient({ apiUrl: "https://api.acme.test/api" } as never)).toThrow(
      TypeError,
    );
  });

  test("a host callback that returns no kst_, or no expiry, is refused before any request", async () => {
    const { fetch } = server(() => json(PORTAL));

    await expect(
      sessionClient(
        fetch,
        sessions({ token: "ksh_secret", expiresAt: "2026-10-06T11:00:00Z" }),
      ).getPortal(),
    ).rejects.toBeInstanceOf(KaitenError);
    await expect(
      sessionClient(fetch, sessions({ token: KST_A, expiresAt: "soon" })).getPortal(),
    ).rejects.toBeInstanceOf(KaitenError);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("routes, methods and bodies of every session call", async () => {
    const answers: Record<string, unknown> = {
      "/api/public/session/portal": PORTAL,
      "/api/public/session/invoices": { items: [], hasMore: false },
      "/api/public/session/checkout": {
        status: "requires_payment_method",
        setupUrl: "https://pay.test/s",
        setupSessionId: "cs_1",
        expiresAt: "2026-10-06T11:00:00Z",
      },
      "/api/public/session/billing/cancel": {
        status: "ACTIVE",
        currency: "EUR",
        cancelAtPeriodEnd: true,
      },
      "/api/public/session/billing/reactivate": {
        status: "ACTIVE",
        currency: "EUR",
        cancelAtPeriodEnd: false,
      },
      "/api/public/session/billing/portal-session": { url: "https://pay.test/p", expiresAt: "x" },
      "/api/public/session/billing/payment-method-session": {
        url: "https://pay.test/m",
        sessionId: "cs_9",
        expiresAt: "x",
      },
      "/api/public/session/billing/payment-method-session/cs_9/complete": {
        paymentMethod: {
          status: "ACTIVE",
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
        },
      },
      "/api/public/session/vouchers/validate": { valid: false },
      "/api/public/session/addons/extra-seats-v1": {
        addonSlug: "extra-seats-v1",
        familySlug: "extra-seats",
        name: "Extra seats",
        quantity: 4,
        maxQuantity: 50,
        prices: [],
      },
    };
    const { fetch, requests } = server((request) => json(answers[new URL(request.url).pathname]));
    const client = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

    await client.getPortal();
    await client.listInvoices({ cursor: "c2", limit: 20 });
    await client.checkout({ licensePriceId: "lp-pro-m", dryRun: true });
    await client.cancelSubscription();
    await client.reactivateSubscription();
    await client.createPortalSession({ returnUrl: "https://app.test/billing" });
    await client.createPaymentMethodSession({
      returnUrl: "https://app.test/billing",
      currencyCode: "EUR",
    });
    await client.completePaymentMethodSession("cs_9");
    await client.validateVoucher({ code: "WELCOME20" });
    const seats = await client.setAddonQuantity("extra-seats-v1", 4);

    const sent = await Promise.all(
      requests.map(async (request) => [
        request.method,
        `${new URL(request.url).pathname}${new URL(request.url).search}`,
        (await request.clone().text()) || undefined,
      ]),
    );
    expect(sent).toEqual([
      ["GET", "/api/public/session/portal", undefined],
      ["GET", "/api/public/session/invoices?cursor=c2&limit=20", undefined],
      ["POST", "/api/public/session/checkout", '{"licensePriceId":"lp-pro-m","dryRun":true}'],
      ["POST", "/api/public/session/billing/cancel", "{}"],
      ["POST", "/api/public/session/billing/reactivate", "{}"],
      [
        "POST",
        "/api/public/session/billing/portal-session",
        '{"returnUrl":"https://app.test/billing"}',
      ],
      [
        "POST",
        "/api/public/session/billing/payment-method-session",
        '{"returnUrl":"https://app.test/billing","currency":"EUR"}',
      ],
      ["POST", "/api/public/session/billing/payment-method-session/cs_9/complete", undefined],
      ["POST", "/api/public/session/vouchers/validate", '{"code":"WELCOME20"}'],
      ["PUT", "/api/public/session/addons/extra-seats-v1", '{"quantity":4}'],
    ]);
    expect(
      requests.every((request) => request.headers.get("Authorization") === `Bearer ${KST_A}`),
    ).toBe(true);
    expect(seats).toMatchObject({ slug: "extra-seats-v1", quantity: 4, maxQuantity: 50 });
  });
});

describe("KaitenSessionClientLike", () => {
  test("is its own interface: KaitenClientLike keeps its five 1.0 methods", () => {
    const sessionLike: KaitenSessionClientLike = sessionClient(
      server(() => json(PORTAL)).fetch,
      sessions(session(KST_A, T0 + 30 * MINUTE)),
    );
    type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
    const unchanged: Same<
      keyof KaitenClientLike,
      "getCatalog" | "getLicensingSnapshot" | "evaluateFlag" | "evaluateFlags" | "reportUsage"
    > = true;

    expect(typeof sessionLike.getPortal).toBe("function");
    expect(unchanged).toBe(true);
  });
});
