// @vitest-environment jsdom
//
// A checkout from choosing a plan to being subscribed: what the server says is due, the setup
// page for a payment method and the way back from it, and what became of the payment. The
// session is a double, whose own model of a checkout is used where it says what Kaiten says
// (a card is captured first, the setup session is completed on return) and scripted where a
// scenario is out of its reach (a payment that needs the customer).

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { CheckoutInput } from "@kaitencloud/client";
import {
  createMockKaitenSessionClient,
  DEMO_SESSION_NOW,
  demoPortal,
  demoVouchers,
  type MockKaitenSessionClient,
} from "@kaitencloud/client/testing";

import { KaitenProvider } from "../src/index.ts";
import { useCheckout, type UseCheckoutOptions, type UseCheckoutResult } from "../src/billing.ts";
import { announceReturn } from "../src/hooks/billing/setup-return.ts";
import {
  activationInvoice,
  alreadySubscribed,
  billingEmailRequired,
  callsOf,
  cannotCapture,
  FAKE_TIMERS,
  line,
  portalWithoutEmail,
  previewOf,
  providerUnavailable,
  quotaExceeded,
  rateLimited,
  REQUIRES_METHOD,
  sessionProvider,
  settle,
  setupIncomplete,
  subscribed,
  unsubscribedSession,
  voucherInvalid,
} from "./support/billing.tsx";

const GROWTH = "price_growth_monthly";
const STARTER = "price_starter_monthly";

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  // The double's setup pages expire an hour after the instant its portal was read.
  vi.setSystemTime(new Date(DEMO_SESSION_NOW));
  window.sessionStorage.clear();
  at("/billing?tab=plan#top");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The checkouts that were made, as opposed to previewed. */
const commits = (client: MockKaitenSessionClient) =>
  (callsOf(client, "checkout") as CheckoutInput[]).filter((input) => !input.dryRun);
const previews = (client: MockKaitenSessionClient) =>
  (callsOf(client, "checkout") as CheckoutInput[]).filter((input) => input.dryRun);

/** A checkout on `client`, with what a test changes of its options, ready to be asked for what is due. */
async function mount(
  client: MockKaitenSessionClient,
  options: UseCheckoutOptions = { initial: { licensePriceId: GROWTH } },
) {
  const view = renderHook(() => useCheckout(options), { wrapper: sessionProvider(client) });
  await settle();
  return {
    view,
    get now(): UseCheckoutResult {
      return view.result.current;
    },
  };
}

/** A popup the browser opened: `window.open` hands back something. */
const popupOpens = () =>
  vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);

/** A customer who has a payment method on file: nothing stands between them and the subscription. */
const withCard = () =>
  createMockKaitenSessionClient({
    portal: {
      ...demoPortal(),
      subscription: null,
      entitlements: [],
      addOns: [],
      upcomingInvoice: null,
    },
  });

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

test("what is chosen is the selection, and the server prices it", async () => {
  const client = unsubscribedSession();
  const probe = await mount(client, { initial: { licensePriceId: GROWTH, addOns: {} } });

  expect(probe.now.available).toBe(true);
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.selection).toEqual({
    licensePriceId: GROWTH,
    addOns: {},
    voucherCode: "",
    skipTrial: false,
    billingEmail: "",
  });
  expect(probe.now.preview.status).toBe("ready");
  expect(probe.now.preview.data?.dueToday).toMatchObject({ currencyCode: "USD", total: 7900 });

  act(() => probe.now.selectPrice(STARTER));
  act(() => probe.now.setAddOnQuantity("extra-seats-v1", 2));
  act(() => probe.now.setSkipTrial(true));
  expect(probe.now.selection).toMatchObject({
    licensePriceId: STARTER,
    addOns: { "extra-seats-v1": 2 },
    skipTrial: true,
  });
});

test("it can be submitted once the server priced the selection, and not before or after it changed", async () => {
  const client = unsubscribedSession();
  const none = await mount(client, { initial: {} });
  expect(none.now.canSubmit).toBe(false);

  const probe = await mount(client);
  expect(probe.now.canSubmit).toBe(true);

  // A selection that moved is not the one that was priced, until it is.
  act(() => probe.now.setAddOnQuantity("extra-seats-v1", 2));
  expect(probe.now.canSubmit).toBe(false);
  await settle(300);
});

test("a code the server refuses cannot be submitted, and a code it prices can", async () => {
  const client = unsubscribedSession();
  const probe = await mount(client);

  act(() => probe.now.setVoucherCode("NOPE"));
  await settle(300);
  expect(probe.now.preview.voucher).toBe("rejected");
  expect(probe.now.problem).toBeNull();
  expect(probe.now.canSubmit).toBe(false);
  await act(async () => probe.now.submit());
  expect(commits(client)).toHaveLength(0);

  act(() => probe.now.setVoucherCode("WELCOME20"));
  await settle(300);
  expect(probe.now.preview.voucher).toBe("applied");
  expect(probe.now.canSubmit).toBe(true);
});

test("outside a customer session there is nothing to check out with, and it says so", async () => {
  const view = renderHook(() => useCheckout({ initial: { licensePriceId: GROWTH } }), {
    wrapper: ({ children }) => (
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {children}
      </KaitenProvider>
    ),
  });
  await settle(1_000);
  expect(view.result.current).toMatchObject({ available: false, canSubmit: false });
  expect(view.result.current.preview.status).toBe("idle");

  await act(async () => view.result.current.submit());
  expect(view.result.current.error?.message).toMatch(/customer-session/);
});

// ---------------------------------------------------------------------------
// A payment method first
// ---------------------------------------------------------------------------

test("a customer with no payment method is sent to the provider's page in a popup, and the checkout goes on when it is done", async () => {
  const open = popupOpens();
  const onSubscribed = vi.fn();
  const client = unsubscribedSession();
  const probe = await mount(client, { initial: { licensePriceId: GROWTH }, onSubscribed });
  act(() => probe.now.setVoucherCode("WELCOME20"));
  await settle(300);

  await act(async () => probe.now.submit());

  // The checkout asked for a payment method, and said where to come back to: this page.
  const [first] = commits(client);
  expect(first).toMatchObject({ licensePriceId: GROWTH, voucherCode: "WELCOME20" });
  expect(new URL(first!.returnUrl!).pathname + new URL(first!.returnUrl!).search).toBe(
    "/billing?tab=plan",
  );
  expect(new URL(first!.returnUrl!).hash).toBe("");
  expect(open).toHaveBeenCalledWith(
    "https://pay.example.test/setup/cs_mock_1",
    "kaiten-setup",
    expect.any(String),
  );
  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.setup).toMatchObject({ sessionId: "cs_mock_1", opening: "popup" });
  expect(probe.now.result).toBeNull();

  // The page the customer lands on in the popup says it is back, and is told someone waits.
  let heard: boolean | undefined;
  await act(async () => {
    void announceReturn("cs_mock_1").then((waited) => (heard = waited));
  });
  await settle(300);

  expect(heard).toBe(true);
  // The same selection, with the setup session, and no return address this time.
  expect(commits(client)[1]).toEqual({
    licensePriceId: GROWTH,
    voucherCode: "WELCOME20",
    setupSessionId: "cs_mock_1",
  });
  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.result?.subscription.status).toBe("ACTIVE");
  expect(probe.now.payment).toMatchObject({ status: "paid", isPaid: true, settlement: "idle" });
  expect(onSubscribed).toHaveBeenCalledTimes(1);
  expect(probe.now.problem).toBeNull();
  // Nothing of the selection is kept once it is done.
  expect(window.sessionStorage.length).toBe(0);
});

test("a popup the browser blocks sends the page itself, and the page that is loaded back goes on with what was chosen", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const navigate = vi.fn();
  const client = unsubscribedSession();
  const first = await mount(client, {
    initial: { licensePriceId: GROWTH, voucherCode: "WELCOME20", skipTrial: true },
    navigate,
  });
  await settle(300);
  await act(async () => first.now.submit());

  expect(navigate).toHaveBeenCalledWith("https://pay.example.test/setup/cs_mock_1");
  expect(first.now.setup).toMatchObject({ opening: "redirect" });
  first.view.unmount();

  // The provider sends the customer back to the page: loaded again, with nothing in memory but what was kept.
  at("/billing?tab=plan&kaiten_setup_session=cs_mock_1#top");
  const back = await mount(client, { initial: {} });
  expect(back.now.step).toBe("selecting");
  await settle(300);

  // What had been chosen is chosen again, and the checkout goes on with the setup session.
  expect(back.now.selection).toMatchObject({
    licensePriceId: GROWTH,
    voucherCode: "WELCOME20",
    skipTrial: true,
  });
  expect(commits(client)[1]).toEqual({
    licensePriceId: GROWTH,
    voucherCode: "WELCOME20",
    trial: false,
    setupSessionId: "cs_mock_1",
  });
  expect(back.now.step).toBe("subscribed");
  // The parameter of the return is out of the address, the host's own is not, and a reload would not do it twice.
  expect(window.location.search).toBe("?tab=plan");
  expect(window.location.hash).toBe("#top");
  expect(window.sessionStorage.length).toBe(0);
});

test("the popup's own page, once it is told someone waits, does nothing but close", async () => {
  popupOpens();
  const close = vi.spyOn(window, "close").mockImplementation(() => {});
  const client = unsubscribedSession();
  const opener = await mount(client);
  await act(async () => opener.now.submit());
  expect(opener.now.step).toBe("awaiting_payment_method");

  // Another instance of the host's page, in the popup, at the return address; what the first kept is its own copy.
  at("/billing?tab=plan&kaiten_setup_session=cs_mock_1");
  const popup = await mount(client, { initial: {} });
  await settle(300);

  // The window that waited went on, once; the popup did not make a second checkout.
  expect(commits(client)).toHaveLength(2);
  expect(opener.now.step).toBe("subscribed");
  expect(popup.now.step).toBe("selecting");
  expect(close).toHaveBeenCalledTimes(1);
  expect(window.location.search).toBe("?tab=plan");
});

test("a return that no checkout kept anything for is left alone", async () => {
  at("/billing?kaiten_setup_session=cs_unknown");
  const client = unsubscribedSession();
  const probe = await mount(client, { initial: { licensePriceId: GROWTH } });
  await settle(1_000);

  expect(probe.now.step).toBe("selecting");
  expect(commits(client)).toHaveLength(0);
  expect(window.location.search).toBe("?kaiten_setup_session=cs_unknown");
});

test("a setup page the customer left without saving a payment method is asked again, with the same session", async () => {
  popupOpens();
  const client = unsubscribedSession();
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  // Back, but the double has not seen the payment method saved: the API says so.
  const check = vi.spyOn(client, "checkout").mockRejectedValueOnce(setupIncomplete());
  await act(async () => probe.now.resume());
  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.problem).toEqual({ kind: "setup_incomplete" });
  expect(probe.now.setup).toMatchObject({ sessionId: "cs_mock_1" });

  await act(async () => probe.now.resume());
  expect(check).toHaveBeenCalledTimes(2);
  expect(check.mock.calls[1]![0]).toMatchObject({ setupSessionId: "cs_mock_1" });
  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.problem).toBeNull();
});

test("a provider that is down when the customer is back keeps them where they are, with the wait", async () => {
  popupOpens();
  const client = unsubscribedSession();
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  vi.spyOn(client, "checkout").mockRejectedValueOnce(providerUnavailable(30));

  await act(async () => probe.now.resume());
  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.problem).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
});

test("a voucher refused at the last moment sends the customer back to choosing, with the setup page forgotten", async () => {
  popupOpens();
  const client = unsubscribedSession();
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  vi.spyOn(client, "checkout").mockRejectedValueOnce(voucherInvalid());

  await act(async () => probe.now.resume());
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "voucher_invalid" });
  expect(probe.now.setup).toBeNull();
  expect(window.sessionStorage.length).toBe(0);
});

// ---------------------------------------------------------------------------
// Subscribing, and what became of the payment
// ---------------------------------------------------------------------------

test("a customer with a payment method is subscribed at once, and the portal and invoices are read again", async () => {
  const open = popupOpens();
  const client = withCard();
  const probe = await mount(client);
  const portalReads = callsOf(client, "getPortal").length;

  await act(async () => probe.now.submit());
  await settle();

  expect(open).not.toHaveBeenCalled();
  expect(commits(client)).toHaveLength(1);
  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.payment).toMatchObject({ status: "paid", isPaid: true });
  expect(callsOf(client, "getPortal").length).toBeGreaterThan(portalReads);
});

/** A double that subscribes with the given payment, whatever is asked, and previews as usual. */
function paying(status: string, invoiceStatus = "PAYMENT_FAILED") {
  const client = unsubscribedSession({
    invoices: [],
    checkout: (input) =>
      input.dryRun
        ? previewOf(4900, [line(1, "BASE", "Pro", 4900)])
        : subscribed(status, activationInvoice(invoiceStatus)),
  });
  return client;
}

test("a paid checkout is done", async () => {
  const client = paying("paid", "PAID");
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  expect(probe.now.payment).toMatchObject({ status: "paid", isPaid: true, settlement: "idle" });
  expect(probe.now.payment?.invoice?.status).toBe("PAID");
});

test("a checkout of a trial, or of a free plan, is subscribed with nothing to pay", async () => {
  const client = unsubscribedSession({
    checkout: (input) => (input.dryRun ? previewOf(0) : subscribed("not_required", null)),
  });
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.payment).toMatchObject({ status: "not_required", isPaid: true, invoice: null });
  // No invoice to wait on, so none is read.
  await settle(60_000);
  expect(callsOf(client, "listInvoices")).toHaveLength(0);
});

test("a payment that needs the customer is waited on until it is paid, every 5 seconds", async () => {
  const client = paying("requires_action");
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.payment).toMatchObject({
    status: "requires_action",
    isPaid: false,
    settlement: "polling",
    hostedInvoiceUrl: "https://pay.example.test/i/inv_activation",
  });

  // The invoice list the customer's payment turns into: the third read sees it paid.
  client.setInvoices([activationInvoice("PAYMENT_FAILED")]);
  await settle(5_000);
  await settle(5_000);
  expect(probe.now.payment?.isPaid).toBe(false);
  client.setInvoices([activationInvoice("PAID")]);
  await settle(5_000);

  expect(callsOf(client, "listInvoices")).toHaveLength(3);
  expect(probe.now.payment).toMatchObject({
    status: "requires_action",
    isPaid: true,
    settlement: "paid",
  });
  expect(probe.now.payment?.invoice?.status).toBe("PAID");
  await settle(60_000);
  expect(callsOf(client, "listInvoices")).toHaveLength(3);
});

test("a payment whose outcome is not known yet is waited on the same way", async () => {
  const client = paying("processing");
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  expect(probe.now.payment).toMatchObject({ status: "processing", settlement: "polling" });
});

test("a payment that never settles stops being read at ten minutes", async () => {
  const client = paying("processing");
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  await settle(10 * 60_000);
  expect(probe.now.payment).toMatchObject({ settlement: "gave_up", isPaid: false });
});

test("a declined card is a subscription whose payment failed, not a failed checkout", async () => {
  const client = paying("failed");
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  expect(probe.now.step).toBe("subscribed");
  expect(probe.now.error).toBeNull();
  expect(probe.now.payment).toMatchObject({ status: "failed", isPaid: false, settlement: "idle" });
  // The link where it can be paid, and nothing is read in the meantime.
  expect(probe.now.payment?.hostedInvoiceUrl).toBe("https://pay.example.test/i/inv_activation");
  await settle(60_000);
  expect(callsOf(client, "listInvoices")).toHaveLength(0);
});

test("a payment not known yet that turns out declined becomes a failed payment, and stops being read", async () => {
  const client = paying("processing");
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  expect(probe.now.payment).toMatchObject({ status: "processing", settlement: "polling" });

  // The charge was refused: the invoice says so at the next read.
  client.setInvoices([activationInvoice("PAYMENT_FAILED")]);
  await settle(5_000);

  expect(probe.now.payment).toMatchObject({
    status: "failed",
    isPaid: false,
    settlement: "failed",
    hostedInvoiceUrl: "https://pay.example.test/i/inv_activation",
  });
  await settle(60_000);
  expect(callsOf(client, "listInvoices")).toHaveLength(1);
});

test("a payment that needs the customer stays that, whichever way the invoice reads", async () => {
  const client = paying("requires_action");
  const probe = await mount(client);
  await act(async () => probe.now.submit());
  client.setInvoices([activationInvoice("PAYMENT_FAILED")]);
  await settle(5_000);

  expect(probe.now.payment).toMatchObject({ status: "requires_action", settlement: "polling" });
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("an instance that is subscribed already is told so as soon as it is priced, and at the checkout", async () => {
  const subscribedAlready = createMockKaitenSessionClient();
  const priced = await mount(subscribedAlready);
  expect(priced.now.step).toBe("already_subscribed");
  expect(priced.now.problem).toEqual({ kind: "already_subscribed" });
  expect(priced.now.canSubmit).toBe(false);

  // Or it became subscribed between the preview and the checkout (another tab).
  const client = unsubscribedSession();
  const probe = await mount(client);
  vi.spyOn(client, "checkout").mockRejectedValueOnce(alreadySubscribed());
  await act(async () => probe.now.submit());
  expect(probe.now.step).toBe("already_subscribed");
  expect(probe.now.problem).toEqual({ kind: "already_subscribed" });
  expect(window.sessionStorage.length).toBe(0);
});

test("a plan the instance is over is refused with the entitlements that are, before and at the checkout", async () => {
  const client = unsubscribedSession({
    checkout: (input) => {
      if (input.dryRun) return previewOf(4900);
      throw quotaExceeded("seats");
    },
  });
  const probe = await mount(client);
  await act(async () => probe.now.submit());

  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "quota_exceeded", entitlementSlugs: ["seats"] });
  expect(probe.now.error).toMatchObject({ status: 422 });

  // Back to choosing: the refusal is the customer's to read, and gone when they choose again.
  act(() => probe.now.reset());
  expect(probe.now.problem).toBeNull();
});

test("what a refused plan is at the preview is the problem, with the slugs", async () => {
  const client = unsubscribedSession({
    checkout: () => {
      throw quotaExceeded("seats", "api-calls");
    },
  });
  const probe = await mount(client);
  expect(probe.now.preview.status).toBe("failed");
  expect(probe.now.problem).toEqual({
    kind: "quota_exceeded",
    entitlementSlugs: ["seats", "api-calls"],
  });
  expect(probe.now.canSubmit).toBe(false);
});

test("a provider that is down at the checkout leaves the customer choosing, with the wait to show", async () => {
  const client = unsubscribedSession();
  const probe = await mount(client);
  vi.spyOn(client, "checkout").mockRejectedValueOnce(providerUnavailable(30));
  await act(async () => probe.now.submit());

  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "unavailable", retryAfterSeconds: 30 });
  expect(probe.now.setup).toBeNull();
});

// ---------------------------------------------------------------------------
// A customer with no billing email
// ---------------------------------------------------------------------------

test("an email is asked for when the customer has none, and nothing is priced until it is one", async () => {
  const client = unsubscribedSession({ portal: portalWithoutEmail() });
  const probe = await mount(client);

  expect(probe.now.needsBillingEmail).toBe(true);
  expect(probe.now.preview.status).toBe("idle");
  expect(probe.now.canSubmit).toBe(false);
  expect(previews(client)).toHaveLength(0);

  act(() => probe.now.setBillingEmail("ops@"));
  await settle(300);
  expect(previews(client)).toHaveLength(0);

  act(() => probe.now.setBillingEmail("ops@acme.example"));
  await settle(300);
  expect(previews(client)[0]).toMatchObject({
    licensePriceId: GROWTH,
    billingEmail: "ops@acme.example",
  });
  expect(probe.now.preview.status).toBe("ready");
  expect(probe.now.canSubmit).toBe(true);
});

test("nothing is priced before the portal has said whether the customer has an email", async () => {
  const client = unsubscribedSession({ portal: portalWithoutEmail() });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = client.getPortal.bind(client);
  vi.spyOn(client, "getPortal").mockImplementation(async () => {
    await gate;
    return read();
  });
  const probe = await mount(client);

  // The first request would be made blind: refused as often as not, for want of an address.
  await settle(1_000);
  expect(probe.now.preview.status).toBe("idle");
  expect(previews(client)).toHaveLength(0);

  release();
  await settle();
  // The portal says there is none: still nothing to ask, until one is given.
  expect(probe.now.needsBillingEmail).toBe(true);
  expect(previews(client)).toHaveLength(0);
});

test("the email goes with the checkout, and again with the setup session, which asks for it as well", async () => {
  popupOpens();
  const client = unsubscribedSession({ portal: portalWithoutEmail() });
  const probe = await mount(client, {
    initial: { licensePriceId: GROWTH, billingEmail: "ops@acme.example" },
  });
  await settle(300);
  await act(async () => probe.now.submit());
  await act(async () => {
    void announceReturn("cs_mock_1");
  });
  await settle(300);

  expect(commits(client).map((input) => input.billingEmail)).toEqual([
    "ops@acme.example",
    "ops@acme.example",
  ]);
  expect(probe.now.step).toBe("subscribed");
});

test("a customer the portal does not say has no email is asked for one when the API says so", async () => {
  // The portal could not be read, so nothing says; the preview is refused for want of an address.
  const client = unsubscribedSession({
    checkout: (input) => {
      if (!input.billingEmail) throw billingEmailRequired();
      return previewOf(4900);
    },
  });
  vi.spyOn(client, "getPortal").mockRejectedValue(new Error("offline"));
  const probe = await mount(client);
  expect(probe.now.preview.status).toBe("failed");
  expect(probe.now.needsBillingEmail).toBe(true);
  expect(probe.now.problem).toEqual({ kind: "billing_email_required" });

  act(() => probe.now.setBillingEmail("ops@acme.example"));
  await settle(300);
  expect(probe.now.preview.status).toBe("ready");
  expect(probe.now.problem).toBeNull();
  expect(probe.now.canSubmit).toBe(true);
});

// ---------------------------------------------------------------------------
// The return address, and the voucher
// ---------------------------------------------------------------------------

test("the return address is the host's when it says one, and the page's otherwise", async () => {
  popupOpens();
  const client = unsubscribedSession();
  const probe = await mount(client, {
    initial: { licensePriceId: GROWTH },
    returnUrl: "https://app.example.test/billing/done",
  });
  await act(async () => probe.now.submit());
  expect(commits(client)[0]!.returnUrl).toBe("https://app.example.test/billing/done");
});

test("the voucher code is in the body of the checkout, in memory, and nowhere else", async () => {
  const logged: unknown[][] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => void logged.push(args));
  }
  const open = popupOpens();
  const events: unknown[] = [];
  const client = unsubscribedSession({
    vouchers: { LEAKCHECK7Q2Z: demoVouchers().WELCOME20! },
  });
  const view = renderHook(
    () => useCheckout({ initial: { licensePriceId: GROWTH, voucherCode: "LEAKCHECK-7Q2Z" } }),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <KaitenProvider
          mode="customer-session"
          sessionClient={client}
          apiUrl="https://kaiten.test/api"
          polling={{ enabled: false }}
          telemetry={{ transport: (event) => void events.push(event), respectDoNotTrack: false }}
        >
          {children}
        </KaitenProvider>
      ),
    },
  );
  await settle(300);
  await act(async () => view.result.current.submit());
  await act(async () => {
    void announceReturn("cs_mock_1");
  });
  await settle(300);

  // It was sent, to the checkout and to nothing else.
  expect(commits(client).some((input) => input.voucherCode === "LEAKCHECK-7Q2Z")).toBe(true);
  expect(view.result.current.step).toBe("subscribed");
  // It is not in a URL: not the one the customer is sent to, not the one they come back to, not the address bar.
  for (const url of [
    ...open.mock.calls.map((call) => String(call[0])),
    ...(callsOf(client, "checkout") as CheckoutInput[]).map((input) => input.returnUrl ?? ""),
    window.location.href,
  ]) {
    expect(url).not.toContain("LEAKCHECK");
  }
  // Nor in a log, nor in what telemetry is told, nor in storage once the checkout is done.
  expect(JSON.stringify(logged)).not.toContain("LEAKCHECK");
  expect(JSON.stringify(events)).not.toContain("LEAKCHECK");
  expect(JSON.stringify(window.sessionStorage)).not.toContain("LEAKCHECK");
  expect(JSON.stringify(view.result.current.error)).not.toContain("LEAKCHECK");
});

// ---------------------------------------------------------------------------
// A voucher the checkout refuses after the preview took it
// ---------------------------------------------------------------------------

/** A double that previews any code as valid, and refuses it when it is checked out. */
function refusingAtCheckout() {
  return unsubscribedSession({
    checkout: (input) => {
      if (input.dryRun)
        return previewOf(input.voucherCode ? 3900 : 4900, [line(1, "BASE", "Pro", 4900)]);
      throw voucherInvalid();
    },
  });
}

test("a voucher refused at the checkout after the preview took it is rejected, and priced without", async () => {
  const client = refusingAtCheckout();
  const probe = await mount(client, {
    initial: { licensePriceId: GROWTH, voucherCode: "WELCOME20" },
  });
  expect(probe.now.preview).toMatchObject({ voucher: "applied", status: "ready" });
  expect(probe.now.preview.data?.dueToday.total).toBe(3900);

  await act(async () => probe.now.submit());
  await settle();

  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "voucher_invalid" });
  // The summary no longer holds the discount, and nothing can be sent until the code is gone.
  expect(probe.now.preview).toMatchObject({ voucher: "rejected" });
  expect(probe.now.canSubmit).toBe(false);
  expect(previews(client).at(-1)).toEqual({ licensePriceId: GROWTH, dryRun: true });
  expect(probe.now.preview.data?.dueToday.total).toBe(4900);

  // Taking the code off is the way on, and it clears the refusal that was about it.
  act(() => probe.now.setVoucherCode(""));
  await settle(300);
  expect(probe.now.problem).toBeNull();
  expect(probe.now.error).toBeNull();
  expect(probe.now.preview).toMatchObject({ voucher: "none", status: "ready" });
  expect(probe.now.canSubmit).toBe(true);
});

test("a code the server could not be reached to judge is still pending, not gone", async () => {
  const client = unsubscribedSession({
    checkout: () => {
      throw providerUnavailable(30);
    },
  });
  const probe = await mount(client, {
    initial: { licensePriceId: GROWTH, voucherCode: "WELCOME20" },
  });

  expect(probe.now.preview.status).toBe("failed");
  expect(probe.now.preview.voucher).toBe("checking");
  expect(probe.now.selection.voucherCode).toBe("WELCOME20");
});

// ---------------------------------------------------------------------------
// Refusals that are not the customer's to fix
// ---------------------------------------------------------------------------

test("too many calls is a wait of its own, and a plan the vendor cannot take payment for cannot be bought", async () => {
  const limited = await mount(
    unsubscribedSession({
      checkout: () => {
        throw rateLimited(45);
      },
    }),
  );
  expect(limited.now.preview.problem).toEqual({ kind: "rate_limited", retryAfterSeconds: 45 });

  const unpayable = await mount(
    unsubscribedSession({
      checkout: () => {
        throw cannotCapture();
      },
    }),
  );
  expect(unpayable.now.preview.problem).toEqual({ kind: "not_payable_online" });
});

// ---------------------------------------------------------------------------
// What is kept for the way back
// ---------------------------------------------------------------------------

test("a page left while a popup is open takes what it kept with it, and one sent away keeps it", async () => {
  popupOpens();
  const client = unsubscribedSession();
  const popup = await mount(client);
  await act(async () => popup.now.submit());
  expect(window.sessionStorage.length).toBe(1);
  popup.view.unmount();
  expect(window.sessionStorage.length).toBe(0);
});

test("an address that is not a web page is never opened", async () => {
  const open = vi.spyOn(window, "open");
  const navigate = vi.fn();
  const client = unsubscribedSession({
    checkout: (input) =>
      input.dryRun
        ? previewOf(4900, [line(1, "BASE", "Pro", 4900)])
        : { ...REQUIRES_METHOD, setupUrl: "javascript:alert(1)" },
  });
  const probe = await mount(client, { initial: { licensePriceId: GROWTH }, navigate });
  await act(async () => probe.now.submit());

  expect(open).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.error).toBeInstanceOf(Error);
  expect(window.sessionStorage.length).toBe(0);
});

test("a payment-method session the page is back from is completed once, by the checkout alone", async () => {
  const client = unsubscribedSession();
  const { sessionId } = await client.createPaymentMethodSession({
    returnUrl: "https://app.test/",
    currencyCode: "USD",
  });
  const complete = vi.spyOn(client, "completePaymentMethodSession");
  window.sessionStorage.setItem(
    "kaiten:pending:payment-method",
    JSON.stringify({
      sessionId,
      expiresAt: Date.now() + 60_000,
      data: { sessionId },
    }),
  );
  at(`/billing?kaiten_setup_session=${sessionId}`);
  await mount(client, { initial: {} });
  await settle(1_000);

  expect(complete).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledWith(sessionId);
  expect(window.location.search).toBe("");
  expect(window.sessionStorage.length).toBe(0);
});
