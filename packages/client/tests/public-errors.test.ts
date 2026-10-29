// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { KaitenError, KaitenNetworkError, KaitenSessionClient } from "../src/index.ts";

const KST = `kst_${"A".repeat(43)}`;

/** One call per public operation, as a host would make it. */
const OPERATIONS = {
  getPortal: (client: KaitenSessionClient) => client.getPortal(),
  listInvoices: (client: KaitenSessionClient) => client.listInvoices(),
  checkout: (client: KaitenSessionClient) => client.checkout({ licensePriceId: "lp-pro-m" }),
  cancelSubscription: (client: KaitenSessionClient) => client.cancelSubscription(),
  reactivateSubscription: (client: KaitenSessionClient) => client.reactivateSubscription(),
  createPortalSession: (client: KaitenSessionClient) =>
    client.createPortalSession({ returnUrl: "https://app.test" }),
  createPaymentMethodSession: (client: KaitenSessionClient) =>
    client.createPaymentMethodSession({ returnUrl: "https://app.test" }),
  completePaymentMethodSession: (client: KaitenSessionClient) =>
    client.completePaymentMethodSession("cs_1"),
  validateVoucher: (client: KaitenSessionClient) => client.validateVoucher({ code: "NOPE" }),
  setAddonQuantity: (client: KaitenSessionClient) => client.setAddonQuantity("extra-seats-v1", 3),
} satisfies Record<string, (client: KaitenSessionClient) => Promise<unknown>>;

type Operation = keyof typeof OPERATIONS;

/** The public codes of the API, each with its status and an operation that answers it. */
const CODES: [Operation, number, string][] = [
  ["getPortal", 403, "PublicAuth.OriginNotAllowed"],
  ["getPortal", 403, "Auth.WrongCredentialKind"],
  ["getPortal", 403, "Billing.Disabled"],
  ["getPortal", 403, "Billing.NotEntitled"],
  ["getPortal", 503, "Billing.EntitlementCheckUnavailable"],
  ["listInvoices", 429, "PublicAuth.RateLimited"],
  ["checkout", 409, "CreateSessionCheckout.AlreadySubscribed"],
  ["checkout", 409, "CreateSessionCheckout.SetupSessionIncomplete"],
  ["checkout", 422, "CreateSessionCheckout.PriceNotPublic"],
  ["checkout", 422, "CreateSessionCheckout.AddonNotPublic"],
  ["checkout", 422, "CreateSessionCheckout.ProviderCannotCapturePayment"],
  ["checkout", 422, "CreateSessionCheckout.BillingEmailRequired"],
  ["checkout", 422, "CreateSessionCheckout.VoucherInvalid"],
  ["checkout", 422, "CreateSessionCheckout.InstanceRequired"],
  ["checkout", 422, "CreateSessionCheckout.QuantityExceedsMax"],
  ["checkout", 422, "CreateSessionCheckout.InvalidReturnUrl"],
  ["checkout", 503, "CreateSessionCheckout.ProviderUnavailable"],
  ["cancelSubscription", 409, "CancelSessionSubscription.NotActive"],
  ["cancelSubscription", 409, "CancelSessionSubscription.BoundaryPending"],
  ["cancelSubscription", 422, "CancelSessionSubscription.InstanceRequired"],
  ["reactivateSubscription", 409, "ReactivateSessionSubscription.NotScheduledForCancellation"],
  ["reactivateSubscription", 409, "ReactivateSessionSubscription.BoundaryPending"],
  ["createPortalSession", 422, "CreateSessionPortalSession.ProviderNotConnected"],
  ["createPortalSession", 422, "CreateSessionPortalSession.CustomerNotOnProvider"],
  ["createPortalSession", 503, "CreateSessionPortalSession.ProviderUnavailable"],
  ["createPaymentMethodSession", 422, "CreateSessionPaymentMethodSession.CurrencyRequired"],
  ["createPaymentMethodSession", 503, "CreateSessionPaymentMethodSession.ProviderUnavailable"],
  ["completePaymentMethodSession", 404, "CompleteSessionPaymentMethodSession.SessionNotFound"],
  ["completePaymentMethodSession", 409, "CompleteSessionPaymentMethodSession.SessionNotComplete"],
  ["validateVoucher", 429, "ValidateSessionVoucher.RateLimited"],
  ["setAddonQuantity", 409, "SetSessionAddonQuantity.OtherVersionAttached"],
  ["setAddonQuantity", 409, "SetSessionAddonQuantity.BoundaryPending"],
  ["setAddonQuantity", 422, "SetSessionAddonQuantity.QuantityExceedsMax"],
];

function problem(status: number, code: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ title: code, status, code }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

function clientWith(fetch: (input: RequestInfo | URL) => Promise<Response>, onAuthError = vi.fn()) {
  return new KaitenSessionClient({
    apiUrl: "https://api.acme.test/api",
    fetch,
    onAuthError,
    getCustomerSession: () => ({ token: KST, expiresAt: "2099-01-01T00:00:00.000Z" }),
  });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("typed errors: every public code reaches the host intact", () => {
  test.each(CODES)("%s answering %i %s", async (operation, status, code) => {
    const fetch = vi.fn(async () =>
      problem(
        status,
        code,
        status === 429 || code.endsWith(".BoundaryPending") ? { "Retry-After": "60" } : {},
      ),
    );

    const failure = await OPERATIONS[operation](clientWith(fetch)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KaitenError);
    expect(failure).toMatchObject({ status, code });
    if (status === 429 || code.endsWith(".BoundaryPending")) {
      expect((failure as KaitenError).retryAfterSeconds).toBe(60);
    }
    // A read is replayed after a 5xx; a write never is, and nothing is replayed
    // on a 4xx.
    const read = operation === "getPortal" || operation === "listInvoices";
    expect(fetch).toHaveBeenCalledTimes(read && status >= 500 ? 3 : 1);
  });

  test("Retry-After as an HTTP date is read as seconds from now", async () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const fetch = vi.fn(async () => problem(429, "PublicAuth.RateLimited", { "Retry-After": at }));

    const failure = (await clientWith(fetch)
      .getPortal()
      .catch((error: unknown) => error)) as KaitenError;

    expect(failure.retryAfterSeconds).toBeGreaterThanOrEqual(29);
    expect(failure.retryAfterSeconds).toBeLessThanOrEqual(30);
  });

  test("a network failure rejects with KaitenNetworkError; a write is not replayed", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(clientWith(fetch).checkout({ licensePriceId: "lp-pro-m" })).rejects.toBeInstanceOf(
      KaitenNetworkError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("an operation not served yet answers 404 as a KaitenError, not a crash", async () => {
    const fetch = vi.fn(async () => new Response("not found", { status: 404 }));

    await expect(clientWith(fetch).getPortal()).rejects.toMatchObject({ status: 404 });
  });
});
