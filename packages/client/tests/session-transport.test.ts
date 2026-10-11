import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError, KaitenSessionClient } from "../src/index.ts";
import type {
  KaitenApi,
  KaitenClientLike,
  KaitenCustomerSession,
  KaitenSessionClientLike,
} from "../src/index.ts";
import { answer } from "./support/session-answers.ts";

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
      "/api/public/session/billing/cancel": answer("cancel"),
      "/api/public/session/billing/reactivate": answer("reactivate"),
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
      ["POST", "/api/public/session/billing/reactivate", undefined],
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

// The checkout and the invoices as the contract types them: each payload below is
// checked against the generated type of its route, so it is what the API serves,
// not what the client expects it to.
describe("checkout and invoices, on payloads the contract types", () => {
  const invoice = {
    id: "inv-1",
    kind: "ACTIVATION",
    status: "PAID",
    currency: "EUR",
    subtotal: 2900,
    discountTotal: 0,
    total: 2900,
    issuedAt: "2026-10-08T10:00:00Z",
    dueAt: "2026-10-08T10:00:00Z",
    paidAt: "2026-10-08T10:00:01Z",
    serviceFrom: "2026-10-08T10:00:00Z",
    serviceTo: "2026-11-08T10:00:00Z",
    providerInvoiceNumber: "INV-0001",
    externalReference: null,
    hostedInvoiceUrl: "https://pay.example/inv-1",
    invoicePdfUrl: null,
    lines: [
      {
        seq: 1,
        type: "BASE",
        label: "Pro",
        description: "",
        quantity: "1",
        unitAmountDecimal: "2900",
        amount: 2900,
        serviceFrom: "2026-10-08T10:00:00Z",
        serviceTo: "2026-11-08T10:00:00Z",
      },
    ],
  } satisfies KaitenApi.SessionInvoice;

  const subscribed = {
    status: "subscribed",
    subscription: {
      status: "ACTIVE",
      providerKind: "STRIPE",
      collectionMethod: "CHARGE_AUTOMATICALLY",
      currency: "EUR",
      billingPeriod: "MONTHLY",
      basePrice: {
        id: "p-m",
        billingModel: "FLAT_FEE",
        billingTiming: "ADVANCE",
        billingPeriod: "MONTHLY",
        currency: "EUR",
        unitAmount: 2900,
        unitAmountDecimal: "2900",
        displayOrder: 0,
        isDefault: true,
      },
      currentPeriodStart: "2026-10-08T10:00:00Z",
      currentPeriodEnd: "2026-11-08T10:00:00Z",
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    },
    activationInvoice: invoice,
    payment: { status: "paid", hostedInvoiceUrl: "https://pay.example/inv-1" },
  } satisfies KaitenApi.SessionCheckout;

  const open = (reply: () => Response) => {
    const { fetch, requests } = server(reply);
    return {
      fetch,
      requests,
      client: sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE))),
    };
  };

  test("checks out with the session as a bearer token, and maps the answer", async () => {
    const { client, requests } = open(() => json(subscribed, 201));

    const result = await client.checkout({
      licensePriceId: "p-m",
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(new URL(request.url).pathname).toBe("/api/public/session/checkout");
    expect(request.method).toBe("POST");
    expect(request.headers.get("Authorization")).toBe(`Bearer ${KST_A}`);
    expect(request.credentials).toBe("omit");
    expect(await request.clone().json()).toEqual({
      licensePriceId: "p-m",
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
    });

    expect(result.status).toBe("subscribed");
    if (result.status !== "subscribed") return;
    expect(result.payment).toEqual({
      status: "paid",
      hostedInvoiceUrl: "https://pay.example/inv-1",
    });
    expect(result.subscription).toMatchObject({
      status: "ACTIVE",
      currencyCode: "EUR",
      billingInterval: "month",
      scheduledChange: null,
    });
    expect(result.subscription.basePrice).toMatchObject({
      amount: 2900,
      interval: "month",
      isDefault: true,
    });
    expect(result.activationInvoice).toMatchObject({
      currencyCode: "EUR",
      total: 2900,
      status: "PAID",
    });
    expect(result.activationInvoice?.lines[0]).toMatchObject({ type: "BASE", amount: 2900 });
  });

  test("a payment answer without a hosted page says so with null", async () => {
    const { client } = open(() =>
      json(
        { ...subscribed, payment: { status: "not_required" } } satisfies KaitenApi.SessionCheckout,
        201,
      ),
    );

    const result = await client.checkout({ licensePriceId: "p-m" });

    expect(result).toMatchObject({
      status: "subscribed",
      payment: { status: "not_required", hostedInvoiceUrl: null },
    });
  });

  test("previews with dryRun, and passes a setup page through", async () => {
    const preview = {
      status: "preview",
      dueToday: { currency: "EUR", subtotal: 2900, discountTotal: 0, total: 2900, lines: [] },
    } satisfies KaitenApi.SessionCheckout;
    const setup = {
      status: "requires_payment_method",
      setupUrl: "https://checkout.stripe.test/setup",
      setupSessionId: "cs_1",
      expiresAt: "2026-10-09T10:00:00Z",
    } satisfies KaitenApi.SessionCheckout;
    const answers = [preview, setup];
    const { fetch, requests } = server((_request, index) => json(answers[index]));
    const client = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

    expect(await client.checkout({ licensePriceId: "p-m", dryRun: true })).toEqual({
      status: "preview",
      dueToday: { currencyCode: "EUR", subtotal: 2900, discountTotal: 0, total: 2900, lines: [] },
      trialEndsAt: null,
    });
    expect(
      await client.checkout({ licensePriceId: "p-m", returnUrl: "https://app.test/billing" }),
    ).toEqual(setup);

    expect(await requests[0]!.clone().json()).toEqual({ licensePriceId: "p-m", dryRun: true });
    expect(await requests[1]!.clone().json()).toEqual({
      licensePriceId: "p-m",
      returnUrl: "https://app.test/billing",
    });
  });

  test("lists the customer's invoices", async () => {
    const page = { items: [invoice], hasMore: false } satisfies KaitenApi.PageSessionInvoice;
    const { client, requests } = open(() => json(page));

    const result = await client.listInvoices({ limit: 10 });

    const url = new URL(requests[0]!.url);
    expect(url.pathname).toBe("/api/public/session/invoices");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(result.items[0]).toMatchObject({
      id: "inv-1",
      currencyCode: "EUR",
      hostedInvoiceUrl: "https://pay.example/inv-1",
    });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });

  test("a publishable key or a secret is no session: refused before any request", async () => {
    for (const token of [`pk_${"a".repeat(43)}`, "ksh_secret"]) {
      const { fetch } = server(() => json({}));
      const client = sessionClient(
        fetch,
        sessions({ token, expiresAt: new Date(T0 + 30 * MINUTE).toISOString() }),
      );

      await expect(client.checkout({ licensePriceId: "p-m" })).rejects.toMatchObject({
        status: 0,
        message: "Invalid customer session",
      });
      await expect(client.listInvoices()).rejects.toMatchObject({ status: 0 });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  test("the general client has no session calls: a kst_ never goes through it", () => {
    const general = new KaitenClient({
      apiUrl: "https://api.acme.test/api",
      authScheme: "bearer",
      tokenProvider: () => KST_A,
    }) as unknown as Record<string, unknown>;

    for (const call of ["checkout", "previewCheckout", "invoices", "getPortal", "session"]) {
      expect(general[call]).toBeUndefined();
    }
  });
});
