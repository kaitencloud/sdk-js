// @vitest-environment jsdom
//
// What a customer changes about their subscription, as hooks: every change reads the portal
// again before it resolves, a refusal made while a billing period is being closed is waited out
// once, and the provider's pages are opened and come back to. The session is a double, so what
// is pinned is the calls it received and what the hooks make of its answers.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { usePortal } from "../src/index.ts";
import {
  useBillingPortal,
  useCancelSubscription,
  usePaymentMethodSession,
  useReactivateSubscription,
  useSetAddonQuantity,
  useValidateVoucher,
} from "../src/billing.ts";
import { announceReturn } from "../src/hooks/billing/setup-return.ts";
import { MAX_BOUNDARY_WAIT_SECONDS } from "../src/hooks/billing/use-portal-actions.ts";
import {
  boundaryPending,
  callsOf,
  FAKE_TIMERS,
  providerUnavailable,
  rateLimited,
  setupNotComplete,
  sessionProvider,
  settle,
} from "./support/billing.tsx";
import { KaitenError } from "@kaitencloud/client";
import { createMockKaitenSessionClient, DEMO_SESSION_NOW } from "@kaitencloud/client/testing";

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  window.sessionStorage.clear();
  at("/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A hook next to the portal the provider reads, to see what a change did to it. */
function withPortal<T>(hook: () => T, client: ReturnType<typeof createMockKaitenSessionClient>) {
  return renderHook(() => ({ action: hook(), portal: usePortal() }), {
    wrapper: sessionProvider(client),
  });
}

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

test("cancelling is sent with its reason, and the portal it resolves with is the one that says so", async () => {
  const client = createMockKaitenSessionClient();
  const view = withPortal(() => useCancelSubscription(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());
  expect(view.result.current.portal.data!.subscription!.cancelAtPeriodEnd).toBe(false);

  let subscription;
  await act(async () => {
    subscription = await view.result.current.action.mutateAsync({ reason: "too expensive" });
  });

  expect(callsOf(client, "cancelSubscription")).toEqual([{ reason: "too expensive" }]);
  expect(subscription).toMatchObject({ cancelAtPeriodEnd: true });
  // Read again before the call resolved: no frame in which the portal still says renews.
  expect(view.result.current.portal.data!.subscription!.cancelAtPeriodEnd).toBe(true);
  expect(view.result.current.portal.data!.capabilities.unsubscribe).toBe(false);
  expect(view.result.current.action).toMatchObject({
    isPending: false,
    error: null,
    retryAt: null,
  });
});

test("a cancellation is sent with no reason when the customer gave none", async () => {
  const client = createMockKaitenSessionClient();
  const view = withPortal(() => useCancelSubscription(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await view.result.current.action.mutateAsync();
  });
  expect(callsOf(client, "cancelSubscription")).toEqual([{}]);
});

test("reactivating withdraws the cancellation, and the portal is read again", async () => {
  const client = createMockKaitenSessionClient();
  const view = withPortal(
    () => ({ cancel: useCancelSubscription(), reactivate: useReactivateSubscription() }),
    client,
  );
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());
  await act(async () => {
    await view.result.current.action.cancel.mutateAsync();
  });

  await act(async () => {
    await view.result.current.action.reactivate.mutateAsync();
  });
  expect(callsOf(client, "reactivateSubscription")).toHaveLength(1);
  expect(view.result.current.portal.data!.subscription!.cancelAtPeriodEnd).toBe(false);
});

test("a refusal that is not a wait is the error, and the hook calls it once", async () => {
  const client = createMockKaitenSessionClient();
  const onError = vi.fn();
  const view = withPortal(() => useReactivateSubscription({ onError }), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  // Not scheduled for cancellation: the double refuses it as the API does.
  await act(async () => {
    await expect(view.result.current.action.mutateAsync()).rejects.toMatchObject({
      status: 409,
      code: "ReactivateSessionSubscription.NotScheduledForCancellation",
    });
  });
  expect(callsOf(client, "reactivateSubscription")).toHaveLength(1);
  expect(view.result.current.action.error).toMatchObject({ status: 409 });
  expect(onError).toHaveBeenCalledTimes(1);
});

test("an add-on is set to a quantity, and 0 detaches it", async () => {
  const client = createMockKaitenSessionClient();
  const view = withPortal(() => useSetAddonQuantity(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await view.result.current.action.mutateAsync({ addonSlug: "extra-seats-v1", quantity: 3 });
  });
  expect(view.result.current.portal.data!.addOns[0]).toMatchObject({
    slug: "extra-seats-v1",
    quantity: 3,
  });

  await act(async () => {
    await view.result.current.action.mutateAsync({ addonSlug: "extra-seats-v1", quantity: 0 });
  });
  expect(view.result.current.portal.data!.addOns).toHaveLength(0);
  expect(
    client.calls.filter((call) => call.method === "setAddonQuantity").map((call) => call.args),
  ).toEqual([
    ["extra-seats-v1", 3],
    ["extra-seats-v1", 0],
  ]);
});

test("a refused change to an add-on is named in problem, and the next change clears it", async () => {
  const client = createMockKaitenSessionClient();
  vi.spyOn(client, "setAddonQuantity").mockRejectedValueOnce(
    new KaitenError({
      title: "Unprocessable Entity",
      status: 422,
      code: "SetSessionAddonQuantity.CurrencyMismatch",
      detail: "the add-on is not priced in the subscription's currency",
    }),
  );
  const view = withPortal(() => useSetAddonQuantity(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());
  expect(view.result.current.action.problem).toBeNull();

  const change = { addonSlug: "extra-seats-v1", quantity: 3 };
  await act(async () => {
    await expect(view.result.current.action.mutateAsync(change)).rejects.toMatchObject({
      code: "SetSessionAddonQuantity.CurrencyMismatch",
    });
  });
  expect(view.result.current.action.problem).toEqual({ kind: "currency_mismatch" });
  expect(view.result.current.action.error).toMatchObject({ status: 422 });

  await act(async () => {
    await view.result.current.action.mutateAsync(change);
  });
  expect(view.result.current.action).toMatchObject({ problem: null, error: null });

  // An add-on the double does not know is not for sale.
  await act(async () => {
    await expect(
      view.result.current.action.mutateAsync({ addonSlug: "nope", quantity: 1 }),
    ).rejects.toMatchObject({ code: "SetSessionAddonQuantity.AddonNotPublic" });
  });
  expect(view.result.current.action.problem).toEqual({ kind: "addon_not_public" });
});

// ---------------------------------------------------------------------------
// A billing period that is being closed
// ---------------------------------------------------------------------------

describe("a change refused while the period that ended is being closed", () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
  });

  /** A double whose first `quantity` refusals are the one of a period being closed. */
  function closing(...refusals: Error[]) {
    const client = createMockKaitenSessionClient();
    const spy = vi.spyOn(client, "setAddonQuantity");
    for (const refusal of refusals) spy.mockRejectedValueOnce(refusal);
    return { client, spy };
  }

  const change = { addonSlug: "extra-seats-v1", quantity: 4 };

  test("is sent once more after the wait the API asked for, and says when", async () => {
    const { client, spy } = closing(boundaryPending(60));
    const view = withPortal(() => useSetAddonQuantity(), client);
    await settle();

    let outcome: unknown;
    const started = Date.now();
    await act(async () => {
      void view.result.current.action.mutateAsync(change).then((added) => (outcome = added));
    });
    await settle();

    // Refused, and waiting: still pending, with the time it will be sent again.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(view.result.current.action.isPending).toBe(true);
    expect(view.result.current.action.retryAt).toBe(started + 60_000);
    expect(outcome).toBeUndefined();

    await settle(59_000);
    expect(spy).toHaveBeenCalledTimes(1);
    await settle(1_000);
    // Sent again, with what it was first sent with, and through.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[1]).toEqual(["extra-seats-v1", 4]);
    expect(outcome).toMatchObject({ slug: "extra-seats-v1", quantity: 4 });
    expect(view.result.current.action).toMatchObject({
      isPending: false,
      retryAt: null,
      error: null,
    });
    expect(view.result.current.portal.data!.addOns[0]!.quantity).toBe(4);
  });

  test("is sent once and no more: a second refusal is the answer", async () => {
    const { client, spy } = closing(boundaryPending(60), boundaryPending(60));
    const view = withPortal(() => useSetAddonQuantity(), client);
    await settle();

    let refusal: unknown;
    await act(async () => {
      view.result.current.action.mutateAsync(change).catch((error) => (refusal = error));
    });
    await settle(60_000);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(refusal).toMatchObject({ status: 409, code: "SetSessionAddonQuantity.BoundaryPending" });
    expect(view.result.current.action).toMatchObject({
      isPending: false,
      retryAt: null,
      problem: { kind: "boundary_pending", retryAfterSeconds: 60 },
    });
    await settle(10 * 60_000);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("is not waited out when the API asks for more than a screen can show", async () => {
    const { client, spy } = closing(boundaryPending(MAX_BOUNDARY_WAIT_SECONDS + 1));
    const view = withPortal(() => useSetAddonQuantity(), client);
    await settle();

    let refusal: unknown;
    await act(async () => {
      view.result.current.action.mutateAsync(change).catch((error) => (refusal = error));
    });
    await settle();
    expect(refusal).toMatchObject({ retryAfterSeconds: MAX_BOUNDARY_WAIT_SECONDS + 1 });
    expect(view.result.current.action.retryAt).toBeNull();
    await settle(10 * 60_000);
    expect(spy).toHaveBeenCalledTimes(1);

    // The longest it does wait is the limit itself.
    const { client: other, spy: otherSpy } = closing(boundaryPending(MAX_BOUNDARY_WAIT_SECONDS));
    const waiting = withPortal(() => useSetAddonQuantity(), other);
    await settle();
    await act(async () => {
      void waiting.result.current.action.mutateAsync(change);
    });
    await settle(MAX_BOUNDARY_WAIT_SECONDS * 1000);
    expect(otherSpy).toHaveBeenCalledTimes(2);
  });

  test("is not sent again when the screen went away during the wait, and the refusal is the answer", async () => {
    const { client, spy } = closing(boundaryPending(60));
    const view = withPortal(() => useSetAddonQuantity(), client);
    await settle();

    let refusal: unknown;
    await act(async () => {
      view.result.current.action.mutateAsync(change).catch((error) => (refusal = error));
    });
    await settle();
    view.unmount();
    await settle(120_000);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(refusal).toMatchObject({ status: 409 });
  });

  test("applies to cancelling and reactivating as well, and to nothing else", async () => {
    const client = createMockKaitenSessionClient();
    const cancel = vi
      .spyOn(client, "cancelSubscription")
      .mockRejectedValueOnce(boundaryPending(30));
    const view = withPortal(() => useCancelSubscription(), client);
    await settle();
    await act(async () => {
      void view.result.current.action.mutateAsync();
    });
    await settle(30_000);
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(view.result.current.portal.data!.subscription!.cancelAtPeriodEnd).toBe(true);

    // A refusal to wait out that is not about the period (a provider that is down) is never sent again.
    const down = createMockKaitenSessionClient();
    const portal = vi.spyOn(down, "createPortalSession").mockRejectedValue(providerUnavailable(30));
    const opened = withPortal(() => useBillingPortal({ navigate: vi.fn() }), down);
    await settle();
    await act(async () => {
      await expect(opened.result.current.action.open()).rejects.toMatchObject({
        retryAfterSeconds: 30,
      });
    });
    await settle(120_000);
    expect(portal).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The provider's billing portal
// ---------------------------------------------------------------------------

test("the provider's portal is opened from here and the customer comes back to this page", async () => {
  at("/billing?tab=plan&kaiten_setup_session=cs_x#top");
  const client = createMockKaitenSessionClient();
  const navigate = vi.fn();
  const view = withPortal(() => useBillingPortal({ navigate }), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await view.result.current.action.open();
  });

  const [{ returnUrl }] = callsOf(client, "createPortalSession") as [{ returnUrl: string }];
  const back = new URL(returnUrl);
  expect(back.pathname).toBe("/billing");
  expect(back.search).toBe("?tab=plan");
  expect(back.hash).toBe("");
  expect(navigate).toHaveBeenCalledWith("https://billing.example.test/portal");
});

test("a return address of the host's own is used as it is", async () => {
  const client = createMockKaitenSessionClient();
  const navigate = vi.fn();
  const view = withPortal(() => useBillingPortal({ navigate }), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await view.result.current.action.mutateAsync({ returnUrl: "https://app.example.test/account" });
  });
  expect(callsOf(client, "createPortalSession")).toEqual([
    { returnUrl: "https://app.example.test/account" },
  ]);
  expect(navigate).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// A voucher code, checked on its own
// ---------------------------------------------------------------------------

test("a voucher code is checked and says what it gives, never its code", async () => {
  const client = createMockKaitenSessionClient();
  const view = withPortal(() => useValidateVoucher(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await view.result.current.action.mutateAsync({
      code: "WELCOME20",
      licensePriceId: "price_growth_monthly",
    });
  });
  expect(callsOf(client, "validateVoucher")).toEqual([
    { code: "WELCOME20", licensePriceId: "price_growth_monthly" },
  ]);
  expect(view.result.current.action.data).toMatchObject({
    valid: true,
    voucher: { name: "Welcome 20%" },
  });
  // The hook does not hold the code, in its state or in what it returns.
  expect(JSON.stringify(view.result.current.action.data)).not.toContain("WELCOME20");

  await act(async () => {
    await view.result.current.action.mutateAsync({ code: "NOPE" });
  });
  // Every refusal is the same one, and says nothing else.
  expect(view.result.current.action.data).toEqual({ valid: false });
});

test("a voucher check that is rate limited says how long to wait, and is not sent again", async () => {
  const client = createMockKaitenSessionClient();
  const spy = vi.spyOn(client, "validateVoucher").mockRejectedValue(rateLimited(90));
  const view = withPortal(() => useValidateVoucher(), client);
  await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

  await act(async () => {
    await expect(view.result.current.action.mutateAsync({ code: "NOPE" })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 90,
    });
  });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(view.result.current.action.error).toMatchObject({ retryAfterSeconds: 90 });
  expect(view.result.current.action.retryAt).toBeNull();
});

// ---------------------------------------------------------------------------
// The payment method
// ---------------------------------------------------------------------------

describe("the payment method", () => {
  const options = { currencyCode: "USD" };

  test("the setup page is opened in place of this page, asking to come back to it", async () => {
    at("/billing?tab=card&kaiten_x=1#section");
    const client = createMockKaitenSessionClient();
    const navigate = vi.fn();
    const view = withPortal(() => usePaymentMethodSession({ navigate, ...options }), client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(async () => {
      await view.result.current.action.start();
    });

    const [{ returnUrl, currencyCode }] = callsOf(client, "createPaymentMethodSession") as [
      { returnUrl: string; currencyCode: string },
    ];
    expect(new URL(returnUrl).pathname + new URL(returnUrl).search + new URL(returnUrl).hash).toBe(
      "/billing?tab=card",
    );
    expect(currencyCode).toBe("USD");
    expect(navigate).toHaveBeenCalledWith("https://pay.example.test/setup/cs_mock_1");
    expect(view.result.current.action).toMatchObject({
      status: "awaiting",
      paymentMethod: null,
      error: null,
    });
  });

  test("back on the page, the session is completed and the portal holds the new labels", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    // The double's setup page expires an hour after the instant its portal was read.
    vi.setSystemTime(new Date(DEMO_SESSION_NOW));
    const client = createMockKaitenSessionClient();
    const first = withPortal(
      () => usePaymentMethodSession({ navigate: vi.fn(), ...options }),
      client,
    );
    await settle();
    await act(async () => {
      await first.result.current.action.start();
    });
    first.unmount();

    // The provider's page sends the customer back: this page, loaded again, with the session in the address.
    at("/billing?tab=card&kaiten_setup_session=cs_mock_1");
    const onSaved = vi.fn();
    const back = withPortal(() => usePaymentMethodSession({ onSaved }), client);
    await settle(300);

    expect(callsOf(client, "completePaymentMethodSession")).toEqual(["cs_mock_1"]);
    expect(back.result.current.action.status).toBe("saved");
    expect(back.result.current.action.paymentMethod).toMatchObject({
      brand: "visa",
      last4: "4242",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(back.result.current.portal.data!.paymentMethod).toMatchObject({
      last4: "4242",
      attachedAt: expect.any(String),
    });
    // The parameter is gone, so a reload does not complete it twice; the rest of the address stays.
    expect(window.location.search).toBe("?tab=card");
  });

  test("a return that is not this flow's is left alone", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    at("/billing?kaiten_setup_session=cs_somebody_elses");
    const client = createMockKaitenSessionClient();
    const view = withPortal(() => usePaymentMethodSession(), client);
    await settle(1_000);

    expect(callsOf(client, "completePaymentMethodSession")).toHaveLength(0);
    expect(view.result.current.action.status).toBe("idle");
    expect(window.location.search).toBe("?kaiten_setup_session=cs_somebody_elses");
  });

  test("a payment method that was not saved is an error to try again, and the second try goes through", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    const client = createMockKaitenSessionClient();
    const view = withPortal(
      () => usePaymentMethodSession({ navigate: vi.fn(), ...options }),
      client,
    );
    await settle();
    await act(async () => {
      await view.result.current.action.start();
    });
    vi.spyOn(client, "completePaymentMethodSession").mockRejectedValueOnce(setupNotComplete());

    await act(async () => {
      await view.result.current.action.complete();
    });
    expect(view.result.current.action.status).toBe("failed");
    expect(view.result.current.action.error).toMatchObject({ status: 409 });

    await act(async () => {
      await view.result.current.action.complete();
    });
    expect(view.result.current.action).toMatchObject({ status: "saved", error: null });
  });

  test("beside this page, the popup that is done completes it, and the page it closes is told so", async () => {
    vi.useFakeTimers(FAKE_TIMERS);
    vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
    const client = createMockKaitenSessionClient();
    const view = withPortal(
      () => usePaymentMethodSession({ opening: "popup", ...options }),
      client,
    );
    await settle();
    await act(async () => {
      await view.result.current.action.start();
    });
    expect(window.open).toHaveBeenCalledWith(
      "https://pay.example.test/setup/cs_mock_1",
      "kaiten-setup",
      expect.any(String),
    );

    // The page the customer lands on in the popup says it is back.
    let waited: boolean | undefined;
    await act(async () => {
      void announceReturn("cs_mock_1").then((heard) => (waited = heard));
    });
    await settle(300);

    expect(waited).toBe(true);
    expect(callsOf(client, "completePaymentMethodSession")).toEqual(["cs_mock_1"]);
    expect(view.result.current.action.status).toBe("saved");
  });

  test("a session that could not be opened is the error, and nothing was kept", async () => {
    const client = createMockKaitenSessionClient();
    vi.spyOn(client, "createPaymentMethodSession").mockRejectedValue(providerUnavailable(30));
    const navigate = vi.fn();
    const view = withPortal(() => usePaymentMethodSession({ navigate }), client);
    await waitFor(() => expect(view.result.current.portal.data).toBeDefined());

    await act(async () => {
      await view.result.current.action.start();
    });
    expect(view.result.current.action).toMatchObject({
      status: "failed",
      error: { retryAfterSeconds: 30 },
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(window.sessionStorage.length).toBe(0);
  });
});

test("outside a customer session every action says so, and nothing is asked of anyone", async () => {
  const { KaitenProvider } = await import("../src/index.ts");
  const view = renderHook(() => useCancelSubscription(), {
    wrapper: ({ children }) => (
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {children}
      </KaitenProvider>
    ),
  });
  await act(async () => {
    await expect(view.result.current.mutateAsync()).rejects.toThrow(/customer-session/);
  });
});
