// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, expectTypeOf, test, vi } from "vite-plus/test";

import {
  CHECKOUT_RETURN_PARAM,
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  DueTodayChangedError,
  KaitenAnonymousCheckoutClient,
  KaitenClient,
  KaitenError,
  KaitenNetworkError,
  KaitenSessionClient,
  ProviderUnavailableError,
  RateLimitedError,
  TurnstileFailedError,
  TurnstileUnavailableError,
  isCheckoutSessionToken,
  readCheckoutReturn,
} from "../src/index.ts";
import type {
  CheckoutConfirmation,
  CheckoutSession,
  CheckoutSessionStart,
  KaitenAnonymousCheckoutClientConfig,
  KaitenAnonymousCheckoutClientLike,
  KaitenCheckoutTokenStorage,
  StartCheckoutInput,
} from "../src/index.ts";
import { requestProblems, responseProblems } from "./support/contract-schema.ts";
import {
  API,
  KSC,
  OTHER_KSC,
  OTHER_SESSION_ID,
  PK,
  RETURN_URL,
  SESSION_ID,
  awaitingSession,
  checkoutSession,
  completedSession,
  confirmation,
  nothingDue,
  problem,
  requiresPaymentMethod,
  startOpen,
  startPreview,
} from "./support/checkout-answers.ts";
import { json } from "./support/session-harness.ts";

// The anonymous checkout client, held to the contract in both directions: every
// answer the double serves is checked against the response the contract declares
// for that route and status, and every request the client sends against the
// request body it declares.

const TURNSTILE = "0.turnstile-token-from-the-widget";

/** Contract violations seen by the double of the running test; each test ends by asserting none. */
let violations: string[] = [];
beforeEach(() => {
  violations = [];
});
afterEach(() => {
  expect(violations).toEqual([]);
});

/** A `Storage`, in a map, that remembers what was written to it. */
class MemoryStorage implements KaitenCheckoutTokenStorage {
  readonly items = new Map<string, string>();
  readonly writes: string[] = [];
  getItem = (key: string) => this.items.get(key) ?? null;
  setItem = (key: string, value: string) => {
    this.writes.push(key);
    this.items.set(key, value);
  };
  removeItem = (key: string) => {
    this.items.delete(key);
  };
}

/** A fetch double that records the requests and checks both sides of each against the contract. */
function server(reply: (request: Request, index: number) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    requests.push(request);
    const response = await reply(request, requests.length - 1);
    const path = new URL(request.url).pathname.replace(/^\/api/, "");
    const text = await request.clone().text();
    const answered: unknown = response.headers.get("Content-Type")?.includes("json")
      ? await response.clone().json()
      : undefined;
    violations.push(
      ...requestProblems(request.method, path, text ? JSON.parse(text) : undefined),
      ...responseProblems(request.method, path, response.status, answered),
    );
    return response;
  });
  return { fetch, requests };
}

function open(
  reply: (request: Request, index: number) => Response | Promise<Response>,
  config: Partial<KaitenAnonymousCheckoutClientConfig> = {},
) {
  const { fetch, requests } = server(reply);
  const storage = new MemoryStorage();
  const client = new KaitenAnonymousCheckoutClient({
    apiUrl: API,
    publishableKey: PK,
    fetch,
    storage,
    ...config,
  });
  return { client, requests, storage, fetch };
}

const caught = async (call: Promise<unknown>) => call.catch((thrown: unknown) => thrown);

const pathOf = (request: Request) => new URL(request.url).pathname.replace(/^\/api/, "");

/** The input of a start by plan and period. */
const START: StartCheckoutInput = {
  turnstileToken: TURNSTILE,
  licenseSlug: "growth-v1",
  billingPeriod: "MONTHLY",
  email: "ada@acme.test",
  returnUrl: RETURN_URL,
};

/** A client that already started a session, and the requests it made. */
async function started(
  reply: (request: Request, index: number) => Response | Promise<Response>,
  config: Partial<KaitenAnonymousCheckoutClientConfig> = {},
) {
  let starting = true;
  let after = 0;
  const opened = open((request) => {
    if (starting) return json(startOpen(), 201);
    return reply(request, after++);
  }, config);
  await opened.client.startCheckout(START);
  starting = false;
  opened.requests.length = 0;
  return opened;
}

describe("startCheckout", () => {
  test("starts a checkout on POST /public/checkout-sessions, with the publishable key and nothing else", async () => {
    const { client, requests } = open(() => json(startOpen(), 201));

    await client.startCheckout({
      ...START,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME10",
      trial: false,
      clientReferenceId: "cart-42",
    });

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(pathOf(request)).toBe("/public/checkout-sessions");
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBe(PK);
    expect(request.headers.get("Authorization")).toBeNull();
    expect(request.headers.get("Content-Type")).toBe("application/json");
    expect(request.credentials).toBe("omit");
    expect(await request.json()).toEqual({
      turnstileToken: TURNSTILE,
      licenseSlug: "growth-v1",
      billingPeriod: "MONTHLY",
      email: "ada@acme.test",
      returnUrl: RETURN_URL,
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      voucherCode: "WELCOME10",
      trial: false,
      clientReferenceId: "cart-42",
    });
  });

  test("names the price by its id as well", async () => {
    const { client, requests } = open(() => json(startOpen(), 201));

    await client.startCheckout({
      turnstileToken: TURNSTILE,
      priceId: "00000000-0000-4000-8000-000000000301",
      email: "ada@acme.test",
      returnUrl: RETURN_URL,
    });

    expect(await requests[0]!.json()).toMatchObject({
      priceId: "00000000-0000-4000-8000-000000000301",
    });
  });

  test("a session opened is the server's quote, in the SDK's money, and its token stays with the client", async () => {
    const { client } = open(() =>
      json(startOpen({ trialEndsAt: "2026-11-05T10:00:00Z", trialRefusedReason: null }), 201),
    );

    const result = await client.startCheckout(START);

    expect(result).toEqual({
      status: "open",
      sessionId: SESSION_ID,
      expiresAt: "2026-10-23T10:00:00Z",
      dueToday: {
        currencyCode: "EUR",
        subtotal: 4900,
        discountTotal: 490,
        total: 4410,
        lines: [
          {
            seq: 1,
            type: "BASE",
            label: "Growth, monthly",
            description: "",
            quantity: "1",
            unitAmountDecimal: "4900",
            amount: 4900,
            serviceFrom: "2026-10-22T10:00:00Z",
            serviceTo: "2026-11-22T10:00:00Z",
          },
          {
            seq: 2,
            type: "DISCOUNT",
            label: "WELCOME10",
            description: "",
            quantity: "1",
            unitAmountDecimal: null,
            amount: -490,
            serviceFrom: "2026-10-22T10:00:00Z",
            serviceTo: "2026-11-22T10:00:00Z",
          },
        ],
      },
      trialEndsAt: "2026-11-05T10:00:00Z",
      trialRefusedReason: null,
      requiresPaymentMethod: true,
    });
    expect(JSON.stringify(result)).not.toContain("ksc_");
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });

  test("keeps the token in the storage under the session's id, once", async () => {
    const { client, storage } = open(() => json(startOpen(), 201));

    await client.startCheckout(START);

    expect(storage.writes).toEqual([`kaiten.checkout.${SESSION_ID}`]);
    expect(JSON.parse(storage.items.get(`kaiten.checkout.${SESSION_ID}`)!)).toEqual({
      sessionId: SESSION_ID,
      token: KSC,
    });
  });

  test("a dryRun answers a preview and keeps nothing", async () => {
    const { client, requests, storage } = open(() => json(startPreview()));

    const result = await client.startCheckout({
      turnstileToken: TURNSTILE,
      licenseSlug: "growth-v1",
      billingPeriod: "ANNUAL",
      dryRun: true,
    });

    expect(await requests[0]!.json()).toEqual({
      turnstileToken: TURNSTILE,
      licenseSlug: "growth-v1",
      billingPeriod: "ANNUAL",
      dryRun: true,
    });
    expect(result.status).toBe("preview");
    expect(result).not.toHaveProperty("sessionId");
    expect(result.dueToday.total).toBe(4410);
    expect(storage.writes).toEqual([]);
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
  });

  test("a plan with nothing due today, and the trial it was refused", async () => {
    const { client } = open(() =>
      json(
        startPreview({
          dueToday: nothingDue(),
          trialRefusedReason: "ALREADY_CONSUMED",
          requiresPaymentMethod: false,
        }),
      ),
    );

    const result = await client.startCheckout({ ...START, dryRun: true });

    expect(result).toMatchObject({
      status: "preview",
      dueToday: { currencyCode: "EUR", total: 0, lines: [] },
      trialEndsAt: null,
      trialRefusedReason: "ALREADY_CONSUMED",
      requiresPaymentMethod: false,
    });
  });

  test("a status it does not know reaches the host as it came", async () => {
    const { client } = open(() => json({ ...startPreview(), status: "queued" }));

    expect(await client.startCheckout({ ...START, dryRun: true })).toMatchObject({
      status: "queued",
    });
    // The contract knows no such status: that is the point of the test.
    violations.length = 0;
  });

  test("an opened session without its token is refused, and nothing is kept", async () => {
    const { client, storage } = open(() => json({ ...startOpen(), token: undefined }, 201));

    const error = await caught(client.startCheckout(START));

    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 0, message: "Malformed checkout session" });
    expect(storage.writes).toEqual([]);
  });

  test("a token of another credential class is not taken for the session's", async () => {
    const { client } = open(() => json({ ...startOpen(), token: `kst_${"e".repeat(43)}` }, 201));

    expect(await caught(client.startCheckout(START))).toMatchObject({
      message: "Malformed checkout session",
    });
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
  });

  describe("refuses, before a Turnstile token is spent, a start the API would refuse", () => {
    const refused: [string, StartCheckoutInput][] = [
      ["no token", { ...START, turnstileToken: "" }],
      ["no price", { turnstileToken: TURNSTILE, email: "a@b.test", returnUrl: RETURN_URL }],
      ["both forms of the price", { ...START, priceId: "p" }],
      ["a plan without its period", { ...START, billingPeriod: undefined }],
      ["a period without its plan", { ...START, licenseSlug: undefined }],
      [
        "an empty price",
        { ...START, licenseSlug: undefined, billingPeriod: undefined, priceId: "" },
      ],
      ["no e-mail", { ...START, email: undefined }],
      ["no return URL", { ...START, returnUrl: undefined }],
      ["a reference over 255 characters", { ...START, clientReferenceId: "x".repeat(256) }],
      ["an empty voucher", { ...START, voucherCode: "" }],
      ["an add-on without a quantity", { ...START, addOns: [{ addonSlug: "s" } as never] }],
      ["an add-on of none", { ...START, addOns: [{ addonSlug: "s", quantity: 0 }] }],
      ["an add-on of half a unit", { ...START, addOns: [{ addonSlug: "s", quantity: 1.5 }] }],
    ];

    test.each(refused)("%s", async (_, input) => {
      const { client, requests } = open(() => json(startOpen(), 201));

      expect(await caught(client.startCheckout(input))).toBeInstanceOf(TypeError);
      expect(requests).toHaveLength(0);
    });

    test("a reference of 255 characters and a dryRun without an e-mail go through", async () => {
      const { client, requests } = open(() => json(startPreview()));

      await client.startCheckout({
        turnstileToken: TURNSTILE,
        priceId: "00000000-0000-4000-8000-000000000301",
        clientReferenceId: "x".repeat(255),
        dryRun: true,
      });

      expect(requests).toHaveLength(1);
    });
  });

  test("is never sent again, whatever happens: its Turnstile token is spent", async () => {
    const unavailable = open(() =>
      json(problem(503, "CreateCheckoutSession.TurnstileUnavailable"), 503, { "Retry-After": "0" }),
    );
    expect(await caught(unavailable.client.startCheckout(START))).toBeInstanceOf(
      TurnstileUnavailableError,
    );
    expect(unavailable.requests).toHaveLength(1);

    const failing = server(() => {
      throw new TypeError("offline");
    });
    const client = new KaitenAnonymousCheckoutClient({
      apiUrl: API,
      publishableKey: PK,
      fetch: failing.fetch,
      storage: null,
    });
    expect(await caught(client.startCheckout(START))).toBeInstanceOf(KaitenNetworkError);
    expect(failing.requests).toHaveLength(1);
  });
});

describe("getCheckoutSession", () => {
  test("reads GET /public/checkout-sessions/{sessionId} with the session's token and nothing else", async () => {
    const { client, requests } = await started(() => json(checkoutSession()));

    await client.getCheckoutSession(SESSION_ID);

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("GET");
    expect(pathOf(request)).toBe(`/public/checkout-sessions/${SESSION_ID}`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${KSC}`);
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
    expect(request.credentials).toBe("omit");
    expect(request.url).not.toContain("ksc_");
    expect(request.url).not.toContain(KSC);
  });

  test("maps a session that waits for its payment: money, period, invoice and payment", async () => {
    const { client } = await started(() => json(awaitingSession()));

    const session = await client.getCheckoutSession(SESSION_ID);

    expect(session).toMatchObject({
      sessionId: SESSION_ID,
      status: "AWAITING_PAYMENT",
      email: "ada@acme.test",
      clientReferenceId: "cart-42",
      licenseSlug: "growth-v1",
      billingPeriod: "MONTHLY",
      billingInterval: "month",
      priceId: "00000000-0000-4000-8000-000000000301",
      addOns: [{ addonSlug: "extra-seats-v1", quantity: 2 }],
      dueToday: { currencyCode: "EUR", subtotal: 4900, discountTotal: 490, total: 4410 },
      trialEndsAt: null,
      trialRefusedReason: null,
      requiresPaymentMethod: true,
      expiresAt: "2026-10-23T10:00:00Z",
      customerSlug: "ada-x7k2",
      instanceSlug: "ada-x7k2-main",
      payment: { status: "requires_action", hostedInvoiceUrl: "https://pay.acme.test/i/in_1" },
      createdAt: "2026-10-22T10:00:00Z",
      completedAt: null,
    });
    expect(session).not.toHaveProperty("intervalCount");
    expect(session.activationInvoice).toMatchObject({
      id: "00000000-0000-4000-8000-0000000004a1",
      kind: "ACTIVATION",
      status: "PAYMENT_FAILED",
      currencyCode: "EUR",
      total: 4410,
      hostedInvoiceUrl: "https://pay.acme.test/i/in_1",
    });
  });

  test.each([
    ["QUARTERLY", "month", 3],
    ["SEMI_ANNUAL", "month", 6],
    ["ANNUAL", "year", undefined],
  ])("a %s period is also an interval", async (billingPeriod, interval, intervalCount) => {
    const { client } = await started(() => json(checkoutSession({ billingPeriod })));

    const session = await client.getCheckoutSession(SESSION_ID);

    expect(session.billingPeriod).toBe(billingPeriod);
    expect(session.billingInterval).toBe(interval);
    expect(session.intervalCount).toBe(intervalCount);
  });

  test("a session that has not completed has no customer or instance, and members the API leaves null stay null", async () => {
    const { client } = await started(() => json(checkoutSession({ clientReferenceId: null })));

    expect(await client.getCheckoutSession(SESSION_ID)).toMatchObject({
      clientReferenceId: null,
      customerSlug: null,
      instanceSlug: null,
      activationInvoice: null,
      payment: null,
      completedAt: null,
    });
  });

  test("is read again after a 5xx, after the Retry-After the API sent", async () => {
    const { client, requests } = await started((_, index) =>
      index === 0
        ? json(problem(500, "GetCheckoutSession.Failed"), 500, { "Retry-After": "0" })
        : json(checkoutSession()),
    );

    expect((await client.getCheckoutSession(SESSION_ID)).sessionId).toBe(SESSION_ID);
    expect(requests).toHaveLength(2);
  });

  test("a session that waits for its payment keeps its token for the next read", async () => {
    const { client, requests } = await started(() => json(awaitingSession()));

    await client.getCheckoutSession(SESSION_ID);
    await client.getCheckoutSession(SESSION_ID);

    expect(requests).toHaveLength(2);
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });

  test.each(["COMPLETED", "ABANDONED", "EXPIRED"] as const)(
    "a %s session drops its token, and is answered from memory from then on",
    async (status) => {
      const { client, requests, storage } = await started(() => json(completedSession({ status })));

      const first = await client.getCheckoutSession(SESSION_ID);
      const again = await client.getCheckoutSession(SESSION_ID);

      expect(first.status).toBe(status);
      expect(again).toEqual(first);
      expect(requests).toHaveLength(1);
      expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
      expect(storage.items.size).toBe(0);
    },
  );

  test("an answer given from memory is a copy", async () => {
    const { client } = await started(() => json(completedSession()));
    const first = await client.getCheckoutSession(SESSION_ID);

    first.dueToday.total = 1;
    const again = await client.getCheckoutSession(SESSION_ID);

    expect(again.dueToday.total).toBe(4410);
  });

  test("a session the client holds no token for is not asked for", async () => {
    const { client, requests } = open(() => json(checkoutSession()));

    const error = await caught(client.getCheckoutSession(SESSION_ID));

    expect(error).toBeInstanceOf(CheckoutTokenMissingError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({ status: 0, sessionId: SESSION_ID });
    expect(requests).toHaveLength(0);
  });

  test("a refused token is forgotten, and the host is told", async () => {
    const onAuthError = vi.fn();
    const { client, storage } = await started(
      () => json(problem(401, "PublicAuth.InvalidCredential"), 401),
      { onAuthError },
    );

    const error = await caught(client.getCheckoutSession(SESSION_ID));

    expect(error).toMatchObject({ status: 401, code: "PublicAuth.InvalidCredential" });
    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(onAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, operation: `getCheckoutSession(${SESSION_ID})` }),
    );
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  test("needs the id of a session", async () => {
    const { client, requests } = open(() => json(checkoutSession()));

    expect(await caught(client.getCheckoutSession(""))).toBeInstanceOf(TypeError);
    expect(requests).toHaveLength(0);
  });
});

describe("confirmCheckout", () => {
  test("confirms on POST /public/checkout-sessions/{sessionId}/confirm, with the session's token and no body", async () => {
    const { client, requests } = await started(() => json(requiresPaymentMethod()));

    await client.confirmCheckout(SESSION_ID);

    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.method).toBe("POST");
    expect(pathOf(request)).toBe(`/public/checkout-sessions/${SESSION_ID}/confirm`);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${KSC}`);
    expect(request.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
    expect(request.headers.get("Content-Type")).toBeNull();
    expect(request.credentials).toBe("omit");
    expect(await request.text()).toBe("");
  });

  test("a payment method is needed first: the page to save it, and the token is kept", async () => {
    const { client } = await started(() => json(requiresPaymentMethod()));

    const result = await client.confirmCheckout(SESSION_ID);

    expect(result).toMatchObject({
      status: "requires_payment_method",
      setupUrl: "https://checkout.stripe.test/c/setup_123",
      setupExpiresAt: "2026-10-23T10:00:00Z",
      session: { sessionId: SESSION_ID, status: "OPEN" },
    });
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });

  test("the first invoice is being paid: the session so far, and the token is kept", async () => {
    const { client } = await started(() =>
      json(confirmation({ status: "awaiting_payment", session: awaitingSession() })),
    );

    const result = await client.confirmCheckout(SESSION_ID);

    expect(result.status).toBe("awaiting_payment");
    expect(result).not.toHaveProperty("setupUrl");
    expect(result.session.payment).toEqual({
      status: "requires_action",
      hostedInvoiceUrl: "https://pay.acme.test/i/in_1",
    });
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });

  test("completes with the customer and the instance created, and drops the token", async () => {
    const { client, storage } = await started(() => json(confirmation()));

    const result = await client.confirmCheckout(SESSION_ID);

    expect(result).toMatchObject({
      status: "completed",
      session: {
        status: "COMPLETED",
        customerSlug: "ada-x7k2",
        instanceSlug: "ada-x7k2-main",
        clientReferenceId: "cart-42",
        completedAt: "2026-10-22T10:00:00Z",
      },
    });
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  test("a session known to be closed is not confirmed: it answers as a closed session does", async () => {
    const { client, requests } = await started(() => json(confirmation()));
    await client.confirmCheckout(SESSION_ID);

    const error = await caught(client.confirmCheckout(SESSION_ID));

    expect(error).toBeInstanceOf(CheckoutSessionClosedError);
    expect(error).toMatchObject({
      status: 409,
      code: "ConfirmCheckoutSession.SessionClosed",
      sessionStatus: "COMPLETED",
    });
    expect(requests).toHaveLength(1);
    // And its outcome is still readable, without the network.
    expect((await client.getCheckoutSession(SESSION_ID)).status).toBe("COMPLETED");
    expect(requests).toHaveLength(1);
  });

  test("is never sent again, whatever the answer", async () => {
    const { client, requests } = await started(() =>
      json(problem(503, "ConfirmCheckoutSession.ProviderUnavailable"), 503, {
        "Retry-After": "0",
      }),
    );

    expect(await caught(client.confirmCheckout(SESSION_ID))).toBeInstanceOf(
      ProviderUnavailableError,
    );
    expect(requests).toHaveLength(1);
  });

  test("a session the client holds no token for is not confirmed", async () => {
    const { client, requests } = open(() => json(confirmation()));

    expect(await caught(client.confirmCheckout(SESSION_ID))).toBeInstanceOf(
      CheckoutTokenMissingError,
    );
    expect(requests).toHaveLength(0);
  });

  test("a refused token is forgotten, and the host is told", async () => {
    const onAuthError = vi.fn();
    const { client } = await started(
      () => json(problem(401, "PublicAuth.InvalidCredential"), 401),
      { onAuthError },
    );

    await caught(client.confirmCheckout(SESSION_ID));

    expect(onAuthError).toHaveBeenCalledWith(
      expect.objectContaining({ status: 401, operation: `confirmCheckout(${SESSION_ID})` }),
    );
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
  });

  test("a disabled feature is a 403 the host hears of, and the token is kept", async () => {
    const onAuthError = vi.fn();
    const { client } = await started(
      () => json(problem(403, "ConfirmCheckoutSession.AnonymousCheckoutDisabled"), 403),
      { onAuthError },
    );

    const error = await caught(client.confirmCheckout(SESSION_ID));

    expect(error).toMatchObject({ status: 403 });
    expect(onAuthError).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });
});

describe("the way back from the payment method setup", () => {
  test("a page that reloads confirms again with the token the storage kept", async () => {
    const shared = new MemoryStorage();
    const before = open(() => json(startOpen(), 201), { storage: shared });
    await before.client.startCheckout(START);

    // The hosted setup page sends the visitor back to the return URL, on a new page load.
    const back = readCheckoutReturn(
      `${RETURN_URL}?utm=mail&${CHECKOUT_RETURN_PARAM}=${SESSION_ID}#done`,
    );
    const after = open(() => json(confirmation()), { storage: shared });

    expect(back).toEqual({
      sessionId: SESSION_ID,
      urlWithoutSession: `${RETURN_URL}?utm=mail#done`,
    });
    expect(after.client.holdsCheckoutSession(back!.sessionId)).toBe(true);
    const result = await after.client.confirmCheckout(back!.sessionId);

    expect(result.status).toBe("completed");
    expect(after.requests[0]!.headers.get("Authorization")).toBe(`Bearer ${KSC}`);
    expect(shared.items.size).toBe(0);
  });

  test("without a storage, the redirect loses the token", async () => {
    const before = open(() => json(startOpen(), 201), { storage: null });
    await before.client.startCheckout(START);
    expect(before.client.holdsCheckoutSession(SESSION_ID)).toBe(true);

    const after = open(() => json(confirmation()), { storage: null });

    expect(after.client.holdsCheckoutSession(SESSION_ID)).toBe(false);
    expect(await caught(after.client.confirmCheckout(SESSION_ID))).toBeInstanceOf(
      CheckoutTokenMissingError,
    );
  });

  test("a stored value that is not a session's token is not one", async () => {
    const storage = new MemoryStorage();
    const { client } = open(() => json(confirmation()), { storage });

    for (const stored of [
      "not json",
      "null",
      JSON.stringify({ sessionId: OTHER_SESSION_ID, token: KSC }),
      JSON.stringify({ sessionId: SESSION_ID, token: `kst_${"f".repeat(43)}` }),
      JSON.stringify({ sessionId: SESSION_ID, token: PK }),
    ]) {
      storage.items.set(`kaiten.checkout.${SESSION_ID}`, stored);
      expect(client.holdsCheckoutSession(SESSION_ID), stored).toBe(false);
    }
  });

  test("a confirm that finds the session closed leaves the token for the read that tells how", async () => {
    const { client, requests } = await started((request) =>
      request.method === "POST"
        ? json(
            problem(409, "ConfirmCheckoutSession.SessionClosed", {
              errors: [{ location: "session", message: "closed", value: { status: "EXPIRED" } }],
            }),
            409,
          )
        : json(completedSession({ status: "EXPIRED", customerSlug: null, instanceSlug: null })),
    );

    const error = await caught(client.confirmCheckout(SESSION_ID));

    expect(error).toBeInstanceOf(CheckoutSessionClosedError);
    expect(error).toMatchObject({ status: 409, sessionStatus: "EXPIRED" });
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
    expect((await client.getCheckoutSession(SESSION_ID)).status).toBe("EXPIRED");
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
  });
});

describe("readCheckoutReturn", () => {
  test("reads the session from the return URL, and gives the URL without it", () => {
    expect(readCheckoutReturn(`${RETURN_URL}?kaiten_checkout_session=${SESSION_ID}`)).toEqual({
      sessionId: SESSION_ID,
      urlWithoutSession: RETURN_URL,
    });
    expect(
      readCheckoutReturn(new URL(`${RETURN_URL}?a=1&kaiten_checkout_session=s%201&b=2`)),
    ).toEqual({ sessionId: "s 1", urlWithoutSession: `${RETURN_URL}?a=1&b=2` });
  });

  test("a URL that names no session, or an empty or absurd one, gives none", () => {
    expect(readCheckoutReturn(RETURN_URL)).toBeNull();
    expect(readCheckoutReturn(`${RETURN_URL}?kaiten_checkout_session=`)).toBeNull();
    expect(
      readCheckoutReturn(`${RETURN_URL}?kaiten_checkout_session=${"x".repeat(257)}`),
    ).toBeNull();
    expect(readCheckoutReturn("http://")).toBeNull();
  });

  test("reads the page's own address when it is given none", () => {
    vi.stubGlobal("location", {
      href: `${RETURN_URL}?kaiten_checkout_session=${SESSION_ID}`,
    });
    try {
      expect(readCheckoutReturn()?.sessionId).toBe(SESSION_ID);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(readCheckoutReturn()).toBeNull();
  });
});

describe("the credentials", () => {
  test("each session's token goes to its own session's routes", async () => {
    let starts = 0;
    const { client, requests } = open((request) => {
      if (request.method === "POST") {
        return json(
          starts++ === 0
            ? startOpen()
            : startOpen({ sessionId: OTHER_SESSION_ID, token: OTHER_KSC }),
          201,
        );
      }
      return json(
        checkoutSession({
          sessionId: pathOf(request).includes(OTHER_SESSION_ID) ? OTHER_SESSION_ID : SESSION_ID,
        }),
      );
    });
    await client.startCheckout(START);
    await client.startCheckout(START);
    requests.length = 0;

    await client.getCheckoutSession(OTHER_SESSION_ID);
    await client.getCheckoutSession(SESSION_ID);

    expect(
      requests.map((request) => [pathOf(request), request.headers.get("Authorization")]),
    ).toEqual([
      [`/public/checkout-sessions/${OTHER_SESSION_ID}`, `Bearer ${OTHER_KSC}`],
      [`/public/checkout-sessions/${SESSION_ID}`, `Bearer ${KSC}`],
    ]);
  });

  test("the host's default headers cannot carry a credential of either class", async () => {
    const defaultHeaders = {
      Authorization: "Bearer kst_the-hosts",
      "X-Kaiten-Publishable-Key": "pk_the-hosts",
      "X-App": "shop",
    };
    const { client, requests } = open(
      (request, index) =>
        index === 0
          ? json(startOpen(), 201)
          : json(pathOf(request).endsWith("/confirm") ? confirmation() : checkoutSession()),
      { defaultHeaders },
    );

    await client.startCheckout(START);
    await client.getCheckoutSession(SESSION_ID);
    await client.confirmCheckout(SESSION_ID);

    const [start, read, confirm] = requests as [Request, Request, Request];
    expect(start.headers.get("X-Kaiten-Publishable-Key")).toBe(PK);
    expect(start.headers.get("Authorization")).toBeNull();
    for (const request of [read, confirm]) {
      expect(request.headers.get("Authorization")).toBe(`Bearer ${KSC}`);
      expect(request.headers.get("X-Kaiten-Publishable-Key")).toBeNull();
    }
    for (const request of requests) expect(request.headers.get("X-App")).toBe("shop");
  });

  test("a client is built on a publishable key, and on nothing else", () => {
    const build = (publishableKey: string) =>
      new KaitenAnonymousCheckoutClient({ apiUrl: API, publishableKey, storage: null });

    expect(() => build(PK)).not.toThrow();
    for (const key of [
      "",
      KSC,
      `kst_${"e".repeat(43)}`,
      `ksh_${"e".repeat(43)}`,
      `ksm_${"e".repeat(43)}`,
      "sk_live_x",
      "nope",
    ]) {
      expect(() => build(key), key).toThrow();
    }
  });

  test("a checkout session token is not a publishable key or a customer session for the other clients", async () => {
    const { fetch, requests } = server(() => json({}));

    const catalogue = new KaitenClient({
      apiUrl: API,
      authScheme: "publishable",
      tokenProvider: () => KSC,
      fetch,
    });
    expect(await caught(catalogue.getCatalog())).toBeInstanceOf(KaitenError);

    const portal = new KaitenSessionClient({
      apiUrl: API,
      getCustomerSession: () => ({ token: KSC, expiresAt: "2099-01-01T00:00:00Z" }),
      fetch,
    });
    expect(await caught(portal.getPortal())).toMatchObject({ message: "Invalid customer session" });
    expect(requests).toHaveLength(0);
  });

  test("tells a checkout session token from the other credentials", () => {
    expect(isCheckoutSessionToken(KSC)).toBe(true);
    expect(isCheckoutSessionToken("ksc_")).toBe(false);
    expect(isCheckoutSessionToken(PK)).toBe(false);
    expect(isCheckoutSessionToken(`kst_${"e".repeat(43)}`)).toBe(false);
    expect(isCheckoutSessionToken(undefined)).toBe(false);
  });
});

describe("where the token is kept", () => {
  function stubStorages() {
    const session = new MemoryStorage();
    const local = new MemoryStorage();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    return { session, local };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("by default in sessionStorage, and never in localStorage", async () => {
    const { session, local } = stubStorages();
    const { fetch } = server(() => json(startOpen(), 201));
    const client = new KaitenAnonymousCheckoutClient({ apiUrl: API, publishableKey: PK, fetch });

    await client.startCheckout(START);

    expect(session.writes).toEqual([`kaiten.checkout.${SESSION_ID}`]);
    expect(local.writes).toEqual([]);
  });

  test("storage: null keeps it in memory alone", async () => {
    const { session } = stubStorages();
    const { fetch } = server(() => json(startOpen(), 201));
    const client = new KaitenAnonymousCheckoutClient({
      apiUrl: API,
      publishableKey: PK,
      fetch,
      storage: null,
    });

    await client.startCheckout(START);

    expect(session.writes).toEqual([]);
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
  });

  test("a storage that refuses to be written or read costs the redirect, not the checkout", async () => {
    const refusing: KaitenCheckoutTokenStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const { client } = open(
      (request, index) =>
        index === 0
          ? json(startOpen(), 201)
          : json(pathOf(request).endsWith("/confirm") ? confirmation() : checkoutSession()),
      { storage: refusing },
    );

    await client.startCheckout(START);
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
    expect((await client.getCheckoutSession(SESSION_ID)).status).toBe("OPEN");
    expect((await client.confirmCheckout(SESSION_ID)).status).toBe("completed");
    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
  });

  test("a runtime whose sessionStorage throws on access has memory alone", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    try {
      const { fetch } = server(() => json(startOpen(), 201));
      const client = new KaitenAnonymousCheckoutClient({ apiUrl: API, publishableKey: PK, fetch });

      await client.startCheckout(START);

      expect(client.holdsCheckoutSession(SESSION_ID)).toBe(true);
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });

  test("forgetCheckoutSession drops it from both", async () => {
    const { client, storage } = await started(() => json(checkoutSession()));

    client.forgetCheckoutSession(SESSION_ID);

    expect(client.holdsCheckoutSession(SESSION_ID)).toBe(false);
    expect(storage.items.size).toBe(0);
  });
});

describe("the refusals", () => {
  const refusalOf = async (
    status: number,
    code: string,
    extra: { headers?: Record<string, string>; errors?: never } & Record<string, unknown> = {},
    call: "start" | "confirm" = "start",
  ) => {
    const { headers, ...rest } = extra;
    const body = problem(status, code, rest);
    const { client } =
      call === "start"
        ? open(() => json(body, status, headers))
        : await started(() => json(body, status, headers));
    return caught(
      call === "start" ? client.startCheckout(START) : client.confirmCheckout(SESSION_ID),
    );
  };

  test("a Turnstile token refused asks for a new one", async () => {
    const error = await refusalOf(422, "CreateCheckoutSession.TurnstileFailed");

    expect(error).toBeInstanceOf(TurnstileFailedError);
    expect(error).toBeInstanceOf(KaitenError);
    expect(error).toMatchObject({
      name: "TurnstileFailedError",
      status: 422,
      code: "CreateCheckoutSession.TurnstileFailed",
    });
  });

  test("Turnstile out of reach is a refusal to wait out", async () => {
    const heard = await refusalOf(503, "CreateCheckoutSession.TurnstileUnavailable", {
      headers: { "Retry-After": "30" },
    });
    const unheard = await refusalOf(503, "CreateCheckoutSession.TurnstileUnavailable");

    expect(heard).toBeInstanceOf(TurnstileUnavailableError);
    expect(heard).toMatchObject({ status: 503, retryAfterSeconds: 30 });
    expect(unheard).toBeInstanceOf(TurnstileUnavailableError);
    expect(unheard).toMatchObject({ retryAfterSeconds: 60 });
  });

  test("a confirm after the session closed names how it closed", async () => {
    const error = await refusalOf(
      409,
      "ConfirmCheckoutSession.SessionClosed",
      {
        errors: [
          { location: "session", message: "closed", value: { status: "ABANDONED" } },
        ] as never,
      },
      "confirm",
    );

    expect(error).toBeInstanceOf(CheckoutSessionClosedError);
    expect(error).toMatchObject({ status: 409, sessionStatus: "ABANDONED" });
  });

  test("a session closed without saying how has no status to name", async () => {
    const error = await refusalOf(409, "ConfirmCheckoutSession.SessionClosed", {}, "confirm");

    expect(error).toBeInstanceOf(CheckoutSessionClosedError);
    expect((error as CheckoutSessionClosedError).sessionStatus).toBeUndefined();
  });

  test("a due amount that changed is a refusal of its own", async () => {
    const error = await refusalOf(409, "ConfirmCheckoutSession.DueTodayChanged", {}, "confirm");

    expect(error).toBeInstanceOf(DueTodayChangedError);
    expect(error).toMatchObject({ name: "DueTodayChangedError", status: 409 });
  });

  test.each([
    ["CreateCheckoutSession.RateLimited", "start"],
    ["ConfirmCheckoutSession.RateLimited", "confirm"],
    ["PublicAuth.RateLimited", "start"],
  ] as const)("%s waits, as every other rate limit", async (code, call) => {
    const error = await refusalOf(429, code, { headers: { "Retry-After": "12" } }, call);

    expect(error).toBeInstanceOf(RateLimitedError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 12 });
  });

  test("a provider out of reach waits, as the checkout of a session does", async () => {
    const error = await refusalOf(
      503,
      "ConfirmCheckoutSession.ProviderUnavailable",
      { headers: { "Retry-After": "30" } },
      "confirm",
    );

    expect(error).toBeInstanceOf(ProviderUnavailableError);
    expect(error).toMatchObject({ retryAfterSeconds: 30 });
  });

  test.each([
    [403, "CreateCheckoutSession.AnonymousCheckoutDisabled", "start"],
    [422, "CreateCheckoutSession.TurnstileNotConfigured", "start"],
    [422, "CreateCheckoutSession.InvalidPriceSelection", "start"],
    [422, "CreateCheckoutSession.PriceNotPublic", "start"],
    [422, "CreateCheckoutSession.InvalidEmail", "start"],
    [422, "CreateCheckoutSession.InvalidReturnUrl", "start"],
    [422, "CreateCheckoutSession.VoucherInvalid", "start"],
    [422, "CreateCheckoutSession.FallbackRequired", "start"],
    [403, "PublicAuth.OriginNotAllowed", "start"],
    [409, "ConfirmCheckoutSession.EntitlementLimitReached", "confirm"],
    [422, "ConfirmCheckoutSession.ProviderCannotCapturePayment", "confirm"],
  ] as const)("%i %s stays a plain KaitenError, read by its code", async (status, code, call) => {
    const error = await refusalOf(status, code, {}, call);

    expect(error).toBeInstanceOf(KaitenError);
    expect((error as KaitenError).constructor).toBe(KaitenError);
    expect(error).toMatchObject({ status, code });
  });
});

describe("the contract's routes", () => {
  // The double checks every request and every answer against the contract; these
  // say that the three calls reach three different declared operations.
  test("each call is a declared operation, with the verb and the status the contract gives it", () => {
    expect(responseProblems("POST", "/public/checkout-sessions", 201, startOpen())).toEqual([]);
    expect(responseProblems("POST", "/public/checkout-sessions", 200, startPreview())).toEqual([]);
    expect(
      responseProblems("GET", `/public/checkout-sessions/${SESSION_ID}`, 200, checkoutSession()),
    ).toEqual([]);
    expect(
      responseProblems(
        "POST",
        `/public/checkout-sessions/${SESSION_ID}/confirm`,
        200,
        requiresPaymentMethod(),
      ),
    ).toEqual([]);
  });

  test("the answers written here are held to the contract, so the check can fail", () => {
    expect(
      responseProblems("POST", "/public/checkout-sessions", 201, { ...startOpen(), status: "x" }),
    ).not.toEqual([]);
    expect(
      responseProblems("GET", `/public/checkout-sessions/${SESSION_ID}`, 200, {
        ...checkoutSession(),
        dueToday: undefined,
      }),
    ).not.toEqual([]);
    expect(requestProblems("POST", "/public/checkout-sessions", { email: "a@b.test" })).not.toEqual(
      [],
    );
    expect(requestProblems("POST", "/public/checkout-sessions", { turnstileToken: "t" })).toEqual(
      [],
    );
  });
});

describe("the types", () => {
  test("the client implements its interface, and the answers are discriminated by status", () => {
    expectTypeOf<KaitenAnonymousCheckoutClient>().toExtend<KaitenAnonymousCheckoutClientLike>();

    const read = (start: CheckoutSessionStart, confirmed: CheckoutConfirmation) => {
      if (start.status === "open") expectTypeOf(start.sessionId).toBeString();
      else expectTypeOf(start).not.toHaveProperty("sessionId");
      if (confirmed.status === "requires_payment_method") {
        expectTypeOf(confirmed.setupUrl).toBeString();
        expectTypeOf(confirmed.session).toEqualTypeOf<CheckoutSession>();
      }
    };
    expect(typeof read).toBe("function");
  });

  test("the start does not hand the session's token to the host", () => {
    expectTypeOf<CheckoutSessionStart>().not.toHaveProperty("token");
  });
});
