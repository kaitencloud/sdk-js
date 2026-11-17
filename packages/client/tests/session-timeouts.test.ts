// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test, vi } from "vite-plus/test";

import { KaitenClient, KaitenSessionClient } from "../src/index.ts";
import type { KaitenSessionClient as SessionClient } from "../src/index.ts";
import { answer } from "./support/session-answers.ts";
import {
  KST_A,
  MINUTE,
  T0,
  json,
  server,
  session,
  sessions,
  useSessionClock,
} from "./support/session-harness.ts";

// How long each call of the session client waits for its answer: `timeoutMs`
// means what it means for `KaitenClient`, and a write that goes through the
// payment provider waits longer than a read when the host sets nothing.
useSessionClock();

const API = "https://api.acme.test/api";
const PRICE = "00000000-0000-4000-8000-000000000201";
const RETURN = "https://app.initech.test/billing";

/** Answers after `ms`, as a network does, and fails as `fetch` does once the request's signal has aborted. */
function late(ms: number, reply: (request: Request) => Response) {
  return async (request: Request) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    if (request.signal.aborted) throw request.signal.reason;
    return reply(request);
  };
}

function sessionClient(
  reply: (request: Request) => Response | Promise<Response>,
  timeoutMs?: number,
) {
  const { fetch, requests } = server(reply);
  const client = new KaitenSessionClient({
    apiUrl: API,
    fetch,
    getCustomerSession: sessions(session(KST_A, T0 + 30 * MINUTE)),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { client, requests };
}

/** The answer of each session route, by the route below `/public/session/`. */
function routes(request: Request): Response {
  const route = new URL(request.url).pathname.replace(/^\/api\/public\/session\//, "");
  if (route === "checkout") return json(answer("checkoutSubscribed"), 201);
  if (route === "billing/portal-session") return json(answer("portalSession"));
  if (route === "billing/payment-method-session") return json(answer("paymentMethodSession"));
  if (route.endsWith("/complete")) return json(answer("paymentMethodCompleted"));
  if (route === "billing/cancel") return json(answer("cancel"));
  if (route === "billing/reactivate") return json(answer("reactivate"));
  if (route === "portal") return json(answer("portal"));
  if (route === "invoices") return json(answer("invoicesEmpty"));
  if (route.startsWith("addons/")) return json(answer("addon"));
  if (route === "vouchers/redeem") return json(answer("redemption"), 201);
  if (route === "vouchers/validate") return json(answer("voucherPercent"));
  throw new Error(`no answer for ${route}`);
}

/** Every call of the session client: first those that go through the payment provider, then the others. */
async function everyCall(client: SessionClient) {
  await client.checkout({ licensePriceId: PRICE });
  await client.createPortalSession({ returnUrl: RETURN });
  await client.createPaymentMethodSession({ returnUrl: RETURN });
  await client.completePaymentMethodSession("cs_setup_2");
  await client.cancelSubscription();

  await client.checkout({ licensePriceId: PRICE, dryRun: true });
  await client.getPortal();
  await client.listInvoices();
  await client.reactivateSubscription();
  await client.setAddonQuantity("extra-seats-v1", 2);
  await client.validateVoucher({ code: "WELCOME20" });
  await client.redeemVoucher({ code: "WELCOME20" });
}
const PROVIDER_CALLS = 5;
const OTHER_CALLS = 7;

describe("timeoutMs", () => {
  test("0 sets no deadline on a session call, as on a KaitenClient call", async () => {
    const management = new KaitenClient({
      apiUrl: API,
      authScheme: "none",
      fetch: server(late(20, () => json([]))).fetch,
      timeoutMs: 0,
    });
    const { client } = sessionClient(
      late(20, () => json(answer("invoicesEmpty"))),
      0,
    );

    expect(await management.getInstanceUsage("initech-prod")).toEqual([]);
    expect((await client.listInvoices()).items).toEqual([]);
  });

  test("0 sets none on any call of the session client", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      const { client, requests } = sessionClient(routes, 0);

      await everyCall(client);

      expect(timeout).not.toHaveBeenCalled();
      expect(requests).toHaveLength(PROVIDER_CALLS + OTHER_CALLS);
    } finally {
      timeout.mockRestore();
    }
  });

  test("a write through the payment provider waits 30 seconds unless the host sets a timeout, any other call 10", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    try {
      for (const [timeoutMs, provider, other] of [
        [undefined, 30_000, 10_000],
        [5_000, 5_000, 5_000],
        [45_000, 45_000, 45_000],
      ] as const) {
        const { client } = sessionClient(routes, timeoutMs);
        timeout.mockClear();

        await everyCall(client);

        expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
          ...Array<number>(PROVIDER_CALLS).fill(provider),
          ...Array<number>(OTHER_CALLS).fill(other),
        ]);
      }
    } finally {
      timeout.mockRestore();
    }
  });
});
