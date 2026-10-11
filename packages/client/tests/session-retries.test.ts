import { describe, expect, test, vi } from "vite-plus/test";

import { KaitenNetworkError } from "../src/index.ts";
import type { KaitenSessionClient } from "../src/index.ts";
import { answer, QUOTA_EXCEEDED, refusal, refused } from "./support/session-answers.ts";
import {
  json,
  KST_A,
  KST_B,
  MINUTE,
  open,
  server,
  session,
  sessionClient,
  sessions,
  T0,
  useSessionClock,
} from "./support/session-harness.ts";

useSessionClock();

// A write is never sent twice: the checkout can subscribe the customer, a
// cancellation and a quantity change are billed, and whether the first attempt
// took effect is not known after a refusal or a failure the client cannot read.
const PRICE = "00000000-0000-4000-8000-000000000201";
const WRITES: Record<string, (client: KaitenSessionClient) => Promise<unknown>> = {
  checkout: (client) => client.checkout({ licensePriceId: PRICE }),
  cancelSubscription: (client) => client.cancelSubscription(),
  reactivateSubscription: (client) => client.reactivateSubscription(),
  createPortalSession: (client) => client.createPortalSession({ returnUrl: "https://app.test/b" }),
  createPaymentMethodSession: (client) =>
    client.createPaymentMethodSession({ returnUrl: "https://app.test/b" }),
  completePaymentMethodSession: (client) => client.completePaymentMethodSession("cs_1"),
  validateVoucher: (client) => client.validateVoucher({ code: "WELCOME20" }),
  setAddonQuantity: (client) => client.setAddonQuantity("extra-seats-v1", 2),
};

const problem = (status: number, headers: Record<string, string> = {}) =>
  json({ title: "Refused", status, code: `Test.${status}` }, status, headers);

describe("a write is sent once", () => {
  for (const [name, write] of Object.entries(WRITES)) {
    for (const [what, reply] of [
      ["409", () => problem(409)],
      ["422", () => problem(422)],
      ["429 with a wait", () => problem(429, { "Retry-After": "30" })],
      ["500", () => problem(500)],
      ["503 with a wait", () => problem(503, { "Retry-After": "30" })],
      ["a response that is not JSON", () => new Response("<h1>Bad gateway</h1>", { status: 502 })],
      // The refusals a host acts on, as Kaiten serves them.
      ["a quota refusal", () => json(QUOTA_EXCEEDED.body, QUOTA_EXCEEDED.status)],
      ["a rate limit, with its wait", () => refused("voucherRateLimited")],
      ["a boundary being closed, with its wait", () => refused("cancelBoundaryPending")],
      ["a provider that is down, with its wait", () => refused("checkoutProviderUnavailable")],
    ] as const) {
      test(`${name}, answered ${what}`, async () => {
        const { client, requests } = open(reply);

        await expect(write(client)).rejects.toMatchObject({ kind: "api" });

        expect(requests).toHaveLength(1);
      });
    }

    test(`${name}, when the network fails`, async () => {
      const fetch = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      const client = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

      await expect(write(client)).rejects.toBeInstanceOf(KaitenNetworkError);

      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }

  test("a refused session is renewed and the write is sent once more, not a third time", async () => {
    const { fetch, requests } = server((_request, index) =>
      index === 0 ? problem(401) : problem(503, { "Retry-After": "30" }),
    );
    const getCustomerSession = sessions(
      session(KST_A, T0 + 30 * MINUTE),
      session(KST_B, T0 + 60 * MINUTE),
    );
    const client = sessionClient(fetch, getCustomerSession);

    await expect(client.checkout({ licensePriceId: PRICE })).rejects.toMatchObject({
      status: 503,
      retryAfterSeconds: 30,
    });

    // The 401 did nothing, so sending the checkout again under a new session is safe.
    expect(requests.map((request) => request.headers.get("Authorization"))).toEqual([
      `Bearer ${KST_A}`,
      `Bearer ${KST_B}`,
    ]);
  });

  test("a 429 and a boundary being closed carry how long to wait, for the host to decide", async () => {
    const waits = [
      ["voucherRateLimited", 90],
      ["cancelBoundaryPending", 60],
      ["checkoutProviderUnavailable", 30],
    ] as const;
    for (const [key, seconds] of waits) {
      const { status, body } = refusal(key);
      const { client } = open(() => json(body, status, { "Retry-After": `${seconds}` }));

      const error = await WRITES["cancelSubscription"]!(client).catch((thrown: unknown) => thrown);

      expect(error).toMatchObject({ status, code: body.code, retryAfterSeconds: seconds });
    }
  });
});

describe("a read is sent again after a failure it can survive", () => {
  test("a 503 on the portal is followed by a second request", async () => {
    const { client, requests } = open((_request, index) =>
      index === 0 ? problem(503) : json(answer("portalCustomerWide")),
    );

    const portal = await client.getPortal();

    expect(portal.customer.slug).toBe("initech");
    expect(requests).toHaveLength(2);
  });

  test("a network failure on the invoices is followed by a second request", async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      if (calls++ === 0) throw new TypeError("Failed to fetch");
      return json(answer("invoicesEmpty"));
    });
    const client = sessionClient(fetch, sessions(session(KST_A, T0 + 30 * MINUTE)));

    expect(await client.listInvoices()).toEqual({ items: [], hasMore: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a refusal is not a failure to survive: 403, 404, 409, 422 and 429 are read once", async () => {
    for (const status of [403, 404, 409, 422, 429]) {
      const { client, requests } = open(() => problem(status));

      await expect(client.getPortal()).rejects.toMatchObject({ status });

      expect(requests).toHaveLength(1);
    }
  });
});
