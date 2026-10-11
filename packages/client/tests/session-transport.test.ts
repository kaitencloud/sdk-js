import { describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenError, KaitenSessionClient } from "../src/index.ts";
import type { KaitenClientLike, KaitenSessionClientLike } from "../src/index.ts";
import { answer } from "./support/session-answers.ts";
import {
  json,
  KST_A,
  KST_B,
  MINUTE,
  server,
  session,
  sessionClient,
  sessions,
  T0,
  useSessionClock,
} from "./support/session-harness.ts";

// A session bound to the customer only: nothing but the customer to read.
const PORTAL = answer("portalCustomerWide");

// Only the clock: the client's own timers (retry delays, timeouts) stay real.
useSessionClock();

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

describe("what a session is, and is not, for", () => {
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
