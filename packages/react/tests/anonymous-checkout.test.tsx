// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// A visitor's checkout from choosing a plan to having bought it: the Turnstile check, the start, the
// review of what is due, the payment provider's page for a payment method and the way back from it,
// and what became of the payment. The client is the double of the anonymous checkout, whose own model
// of a checkout is used where it says what Kaiten says (a payment method first, then the payment) and
// scripted where a scenario is out of its reach.

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  CheckoutTokenMissingError,
  KaitenError,
  KaitenNetworkError,
  TurnstileFailedError,
  type KaitenAnonymousCheckoutClientLike,
} from "@kaitencloud/client";
import {
  createMockKaitenAnonymousCheckoutClient,
  createMockKaitenClient,
  createMockKaitenSessionClient,
  DEMO_SESSION_NOW,
  demoAnonymousCheckoutPlans,
  type MockCheckoutPlan,
  type MockKaitenAnonymousCheckoutClient,
} from "@kaitencloud/client/testing";

import { KaitenProvider } from "../src/index.ts";
import {
  useAnonymousCheckout,
  type UseAnonymousCheckoutOptions,
  type UseAnonymousCheckoutResult,
} from "../src/billing.ts";
import { announceReturn } from "../src/hooks/billing/setup-return.ts";
import {
  anonymousCatalog,
  anonymousProvider,
  flush,
  installFakeTurnstile,
  TEST_SITE_KEY,
  type FakeTurnstile,
} from "./support/anonymous.tsx";
import { FAKE_TIMERS, settle } from "./support/billing.tsx";

const STARTER = "price_starter_monthly";
const GROWTH = "price_growth_monthly";
const LITE = "price_lite_monthly";
const PRO = "price_pro_monthly";
const EMAIL = "ada@example.com";

/** A plan with a trial that asks for a payment method first: nothing is charged before it ends. */
const TRIAL_WITH_CARD: MockCheckoutPlan = {
  licenseSlug: "pro-v1",
  priceId: PRO,
  billingPeriod: "MONTHLY",
  currencyCode: "USD",
  amount: 4900,
  trialDays: 7,
  requiresPaymentMethod: true,
};

let turnstile: FakeTurnstile;

const at = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  // The double's sessions expire a day after the instant its fixtures are set at.
  vi.setSystemTime(new Date(DEMO_SESSION_NOW));
  window.sessionStorage.clear();
  at("/pricing?plan=growth#top");
  turnstile = installFakeTurnstile();
});

afterEach(() => {
  cleanup();
  turnstile.uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const doubleOf = (...extra: MockCheckoutPlan[]) =>
  createMockKaitenAnonymousCheckoutClient({ plans: [...demoAnonymousCheckoutPlans(), ...extra] });

interface Mounted {
  readonly now: UseAnonymousCheckoutResult;
  unmount: () => void;
}

/** A checkout on `client`, with the widget drawn where a component would put it. */
async function mount(
  client: KaitenAnonymousCheckoutClientLike | undefined,
  options: UseAnonymousCheckoutOptions = {},
  catalog = anonymousCatalog(),
): Promise<Mounted> {
  const seen: { current?: UseAnonymousCheckoutResult } = {};
  function Probe() {
    const checkout = useAnonymousCheckout(options);
    seen.current = checkout;
    return checkout.step === "selecting" ? (
      <div data-testid="widget" ref={checkout.turnstile.ref} />
    ) : null;
  }
  const view = render(<Probe />, { wrapper: anonymousProvider(client, catalog) });
  await flush();
  return {
    get now() {
      return seen.current!;
    },
    unmount: view.unmount,
  };
}

/** The visitor has chosen a price and typed an address. */
async function fill(probe: Mounted, priceId = GROWTH, email = EMAIL) {
  act(() => probe.now.selectPrice(priceId));
  act(() => probe.now.setEmail(email));
  await flush();
}

/** Starts the checkout of a price, and lets it settle. */
async function started(probe: Mounted, priceId = GROWTH) {
  await fill(probe, priceId);
  await act(async () => {
    await probe.now.start();
  });
  await flush();
}

const popupOpens = () =>
  vi.spyOn(window, "open").mockReturnValue({ opener: window } as unknown as Window);
const popupBlocked = () => vi.spyOn(window, "open").mockReturnValue(null);

/** Everything the page keeps in this tab and in this browser, as one string to look for a secret in. */
const everythingStored = () =>
  JSON.stringify(
    [window.sessionStorage, window.localStorage].map((storage) =>
      Object.fromEntries(Object.keys(storage).map((key) => [key, storage.getItem(key)])),
    ),
  );

const callsTo = (client: MockKaitenAnonymousCheckoutClient, method: string) =>
  client.calls.filter((call) => call.method === method);

// ---------------------------------------------------------------------------
// Whether there is a checkout to offer
// ---------------------------------------------------------------------------

test("a checkout is offered when the provider has a client and the catalogue says the key may start one", async () => {
  const probe = await mount(doubleOf());
  expect(probe.now.available).toBe(true);
  expect(probe.now.isLoading).toBe(false);
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.turnstile.siteKey).toBe(TEST_SITE_KEY);
});

test.each([
  ["no client", undefined, anonymousCatalog()],
  [
    "a catalogue that does not offer it",
    doubleOf(),
    anonymousCatalog({
      checkout: true,
      paymentMethods: true,
      anonymousCheckout: false,
      turnstileSiteKey: null,
    }),
  ],
  [
    "a catalogue that says nothing of it",
    doubleOf(),
    anonymousCatalog({ checkout: true, paymentMethods: true }),
  ],
  [
    "an offer with no site key",
    doubleOf(),
    anonymousCatalog({
      checkout: true,
      paymentMethods: true,
      anonymousCheckout: true,
      turnstileSiteKey: "",
    }),
  ],
])("nothing is offered with %s, and no widget is drawn", async (_name, client, catalog) => {
  const probe = await mount(client, {}, catalog);
  expect(probe.now.available).toBe(false);
  expect(probe.now.canStart).toBe(false);
  expect(turnstile.widgets).toHaveLength(0);
  await act(async () => expect(await probe.now.start()).toBeNull());
});

// ---------------------------------------------------------------------------
// The Turnstile check
// ---------------------------------------------------------------------------

test("the widget is drawn with the catalogue's site key in the element the page gave, and solves itself", async () => {
  const probe = await mount(doubleOf(), { turnstile: { theme: "dark", language: "fr" } });
  const widget = turnstile.live()!;
  expect(widget.container).toBe(document.querySelector('[data-testid="widget"]'));
  expect(widget.parameters).toMatchObject({
    sitekey: TEST_SITE_KEY,
    theme: "dark",
    language: "fr",
    appearance: "always",
    size: "normal",
    "refresh-expired": "auto",
  });
  expect(probe.now.turnstile.status).toBe("solved");
});

test("a narrow container gets the compact widget", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(272);
  await mount(doubleOf());
  expect(turnstile.live()!.parameters.size).toBe("compact");
});

test("the widget is drawn again at the size its container comes to, and says how much room it needs", async () => {
  let width = 400;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  const observers: Array<() => void> = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  try {
    const probe = await mount(doubleOf());
    expect(turnstile.live()!.parameters.size).toBe("normal");
    expect(probe.now.turnstile.size).toBe("normal");
    const first = turnstile.live()!;

    width = 272;
    act(() => observers.forEach((notify) => notify()));
    await flush();

    expect(first.removed).toBe(true);
    expect(turnstile.live()!.parameters.size).toBe("compact");
    expect(probe.now.turnstile.size).toBe("compact");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("the visitor can start only with a price, a plausible address and a token in hand", async () => {
  const probe = await mount(doubleOf());
  expect(probe.now.canStart).toBe(false);
  act(() => probe.now.selectPrice(GROWTH));
  expect(probe.now.canStart).toBe(false);
  act(() => probe.now.setEmail("ada@"));
  expect(probe.now.canStart).toBe(false);
  act(() => probe.now.setEmail(EMAIL));
  expect(probe.now.canStart).toBe(true);

  // A token that expires is gone until the widget gives another.
  act(() => turnstile.expire());
  expect(probe.now.turnstile.status).toBe("solving");
  expect(probe.now.canStart).toBe(false);
  act(() => turnstile.solve("fresh"));
  expect(probe.now.canStart).toBe(true);
});

test("a price can be named by its plan and period, for a page that does not read the catalogue", async () => {
  const client = doubleOf();
  const probe = await mount(client, {
    initial: { licenseSlug: "growth-v1", billingPeriod: "ANNUAL", email: EMAIL },
  });
  expect(probe.now.canStart).toBe(true);
  await act(async () => {
    await probe.now.start();
  });
  expect(callsTo(client, "startCheckout")[0]!.args[0]).toMatchObject({
    licenseSlug: "growth-v1",
    billingPeriod: "ANNUAL",
  });
  expect(callsTo(client, "startCheckout")[0]!.args[0]).not.toHaveProperty("priceId");
  expect(probe.now.quote?.dueToday.total).toBe(79000);
});

test("a widget that fails is said so, and tried again on request", async () => {
  const probe = await mount(doubleOf());
  act(() => turnstile.fail("300030"));
  expect(probe.now.turnstile.status).toBe("failed");
  expect(probe.now.turnstile.errorCode).toBe("300030");
  expect(probe.now.canStart).toBe(false);

  const drawn = turnstile.widgets.length;
  act(() => probe.now.turnstile.retry());
  await flush();
  expect(turnstile.widgets.length).toBe(drawn + 1);
  expect(turnstile.widgets[drawn - 1]!.removed).toBe(true);
  expect(probe.now.turnstile.status).toBe("solved");
});

test("a widget removed with its element, and not left behind", async () => {
  const probe = await mount(doubleOf());
  const widget = turnstile.live()!;
  probe.unmount();
  expect(widget.removed).toBe(true);
});

// ---------------------------------------------------------------------------
// The start
// ---------------------------------------------------------------------------

test("a start spends the token the widget gave and has the widget produce the next", async () => {
  const client = doubleOf();
  const probe = await mount(client, { clientReferenceId: "cart-42" });
  await fill(probe);
  const token = turnstile.tokens.at(-1)!;

  let quote: unknown;
  await act(async () => (quote = await probe.now.start()));
  await flush();

  const [input] = callsTo(client, "startCheckout")[0]!.args as [Record<string, unknown>];
  expect(input).toMatchObject({
    priceId: GROWTH,
    email: EMAIL,
    turnstileToken: token,
    clientReferenceId: "cart-42",
    dryRun: false,
  });
  // This page, minus its fragment and any kaiten parameter, is where the provider's page returns.
  expect(new URL(input["returnUrl"] as string).pathname).toBe("/pricing");
  expect(new URL(input["returnUrl"] as string).hash).toBe("");
  expect(turnstile.widgets[0]!.resets).toBe(1);
  expect(probe.now.step).toBe("review");
  expect(quote).toMatchObject({ email: EMAIL, requiresPaymentMethod: true });
  expect(probe.now.quote).toMatchObject({
    sessionId: "chk_mock_1",
    dueToday: { total: 7900, currencyCode: "USD" },
    trialEndsAt: null,
    trialRefusedReason: null,
  });
  expect(probe.now.problem).toBeNull();
});

test("the same click cannot start twice", async () => {
  const client = doubleOf();
  const probe = await mount(client);
  await fill(probe);
  await act(async () => {
    const first = probe.now.start();
    const second = probe.now.start();
    await Promise.all([first, second]);
  });
  expect(callsTo(client, "startCheckout")).toHaveLength(1);
});

test("a start is refused for a token that Turnstile refused: back to choosing, a new token to be had", async () => {
  const client = createMockKaitenAnonymousCheckoutClient({
    fail: {
      startCheckout: (call) =>
        call === 1
          ? new TurnstileFailedError({
              title: "turnstile",
              status: 422,
              code: "CreateCheckoutSession.TurnstileFailed",
            })
          : undefined,
    },
  });
  const probe = await mount(client);
  await fill(probe, STARTER);
  await act(async () => expect(await probe.now.start()).toBeNull());
  await flush();

  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "turnstile_failed" });
  expect(probe.now.error).toBeInstanceOf(TurnstileFailedError);
  // What was chosen is still chosen, and the widget has a fresh token for the retry.
  expect(probe.now.selection).toMatchObject({ priceId: STARTER, email: EMAIL });
  expect(probe.now.canStart).toBe(true);
  const spent = (callsTo(client, "startCheckout")[0]!.args[0] as { turnstileToken: string })
    .turnstileToken;
  await act(async () => {
    await probe.now.start();
  });
  await flush();
  expect(
    (callsTo(client, "startCheckout")[1]!.args[0] as { turnstileToken: string }).turnstileToken,
  ).not.toBe(spent);
  expect(probe.now.step).toBe("review");
  expect(probe.now.problem).toBeNull();
});

test("a publishable key refused on the start is a configuration, not a checkout this browser lost", async () => {
  const client = createMockKaitenAnonymousCheckoutClient({
    fail: {
      startCheckout: () =>
        new KaitenError({
          title: "unauthorized",
          status: 401,
          code: "PublicAuth.InvalidCredential",
        }),
    },
  });
  const probe = await mount(client);
  await fill(probe, STARTER);
  await act(async () => expect(await probe.now.start()).toBeNull());
  await flush();

  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toEqual({ kind: "not_available" });
  expect(probe.now.error).toBeInstanceOf(KaitenError);
  // The same on a preview.
  await act(async () => expect(await probe.now.preview()).toBeNull());
  await flush();
  expect(probe.now.problem).toEqual({ kind: "not_available" });
});

test("a return address that is not on the key's origins is a configuration, not a visitor's to retry", async () => {
  const client = createMockKaitenAnonymousCheckoutClient({
    fail: {
      startCheckout: () =>
        new KaitenError({
          title: "invalid",
          status: 422,
          code: "CreateCheckoutSession.InvalidReturnUrl",
        }),
    },
  });
  const probe = await mount(client);
  await fill(probe, STARTER);
  await act(async () => expect(await probe.now.start()).toBeNull());
  await flush();
  expect(probe.now.problem).toEqual({ kind: "not_available" });
});

test("a return address of the page's own that is too long is refused before a token is spent", async () => {
  const client = doubleOf();
  const probe = await mount(client, { returnUrl: `https://shop.example.com/${"a".repeat(2_100)}` });
  await fill(probe, STARTER);
  const widget = turnstile.live()!;
  await act(async () => expect(await probe.now.start()).toBeNull());
  await flush();

  expect(probe.now.error).toBeInstanceOf(TypeError);
  expect(probe.now.step).toBe("selecting");
  expect(callsTo(client, "startCheckout")).toHaveLength(0);
  // The token is still in hand: the widget was not reset, and the visitor is not asked again.
  expect(widget.resets).toBe(0);
  expect(probe.now.canStart).toBe(true);
});

test("the default return address leaves the query out when the page's would be too long to send", async () => {
  at(`/pricing?utm=${"a".repeat(2_100)}#top`);
  const client = doubleOf();
  const probe = await mount(client);
  await started(probe, STARTER);

  expect(probe.now.step).toBe("review");
  const sent = callsTo(client, "startCheckout")[0]!.args[0] as { returnUrl: string };
  expect(sent.returnUrl).toBe(`${window.location.origin}/pricing`);
});

test("the voucher code, the add-ons and a declined trial go in the body of the start, and nowhere else", async () => {
  const client = createMockKaitenAnonymousCheckoutClient({
    fail: {
      startCheckout: new KaitenError({
        title: "x",
        status: 422,
        code: "CreateCheckoutSession.VoucherInvalid",
      }),
    },
  });
  const probe = await mount(client);
  await fill(probe, GROWTH);
  act(() => probe.now.setVoucherCode("  WELCOME20 "));
  act(() => probe.now.setAddonQuantity("seats", 2));
  act(() => probe.now.setAddonQuantity("ghost", 0));
  act(() => probe.now.setSkipTrial(true));
  await act(async () => {
    await probe.now.start();
  });
  await flush();
  expect(callsTo(client, "startCheckout")[0]!.args[0]).toMatchObject({
    voucherCode: "WELCOME20",
    addOns: [{ addonSlug: "seats", quantity: 2 }],
    trial: false,
  });
  expect(probe.now.problem).toEqual({ kind: "voucher_invalid" });
  expect(window.location.href).not.toContain("WELCOME20");
  expect(everythingStored()).not.toContain("WELCOME20");
});

test("a preview asks what a selection would bill and writes nothing", async () => {
  const client = doubleOf();
  const probe = await mount(client);
  act(() => probe.now.selectPrice(GROWTH));
  await flush();

  let preview: unknown;
  await act(async () => (preview = await probe.now.preview()));
  await flush();

  expect(callsTo(client, "startCheckout")[0]!.args[0]).toMatchObject({
    dryRun: true,
    priceId: GROWTH,
  });
  expect(callsTo(client, "startCheckout")[0]!.args[0]).not.toHaveProperty("email");
  expect(preview).toMatchObject({ status: "preview", dueToday: { total: 7900 } });
  expect(probe.now.previewed?.dueToday.total).toBe(7900);
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.quote).toBeNull();
  // It spent a token, so the next is another one; and a moved selection drops what was previewed.
  expect(turnstile.widgets[0]!.resets).toBe(1);
  act(() => probe.now.selectPrice(STARTER));
  expect(probe.now.previewed).toBeNull();
});

// ---------------------------------------------------------------------------
// The paths that need no payment method
// ---------------------------------------------------------------------------

test("a free plan completes at the first confirm, and the page is told once, with the reference", async () => {
  const onComplete = vi.fn();
  const onStarted = vi.fn();
  const client = doubleOf();
  const probe = await mount(client, { onComplete, onStarted, clientReferenceId: "cart-42" });
  act(() => probe.now.setName("  Ada Lovelace "));
  await started(probe, STARTER);

  expect(probe.now.step).toBe("review");
  expect(probe.now.quote).toMatchObject({ requiresPaymentMethod: false, dueToday: { total: 0 } });
  expect(onStarted).toHaveBeenCalledWith({
    sessionId: "chk_mock_1",
    email: EMAIL,
    name: "Ada Lovelace",
  });

  await act(async () => {
    await probe.now.confirm();
  });
  await flush();

  expect(probe.now.step).toBe("completed");
  expect(probe.now.outcome).toMatchObject({
    sessionId: "chk_mock_1",
    clientReferenceId: "cart-42",
    name: "Ada Lovelace",
    session: { status: "COMPLETED", customerSlug: "customer-chk_mock_1" },
  });
  expect(onComplete).toHaveBeenCalledTimes(1);
  // Nothing was due, and nothing is waited on: the payment is not "processing".
  expect(probe.now.payment).toEqual({
    status: "not_required",
    hostedInvoiceUrl: null,
    settlement: "idle",
  });
  // Nothing opened, and nothing was waited on.
  expect(callsTo(client, "getCheckoutSession")).toHaveLength(0);
  // The name was kept for the page until it was handed over, and is gone from the tab.
  expect(window.sessionStorage.getItem("kaiten:pending:anonymous-checkout")).toBeNull();
  // Confirming again does nothing to a checkout that completed.
  await act(async () => {
    await probe.now.confirm();
  });
  expect(callsTo(client, "confirmCheckout")).toHaveLength(1);
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test("a trial that needs no payment method starts at the first confirm and says when it ends", async () => {
  const probe = await mount(doubleOf());
  await started(probe, LITE);
  expect(probe.now.quote).toMatchObject({
    dueToday: { total: 0 },
    requiresPaymentMethod: false,
    trialRefusedReason: null,
  });
  expect(probe.now.quote?.trialEndsAt).not.toBeNull();
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.step).toBe("completed");
  expect(probe.now.session?.trialEndsAt).toBe(probe.now.quote?.trialEndsAt);
  expect(probe.now.payment).toEqual({
    status: "not_required",
    hostedInvoiceUrl: null,
    settlement: "idle",
  });
});

test("a second trial for an e-mail that had one is refused, and the amount due is shown", async () => {
  const client = doubleOf();
  const first = await mount(client);
  await started(first, LITE);
  await act(async () => {
    await first.now.confirm();
  });
  await flush();
  first.unmount();
  cleanup();
  window.sessionStorage.clear();

  const second = await mount(client);
  await started(second, LITE);
  expect(second.now.quote).toMatchObject({
    trialEndsAt: null,
    trialRefusedReason: "ALREADY_CONSUMED",
    dueToday: { total: 1900 },
    requiresPaymentMethod: true,
  });
});

// ---------------------------------------------------------------------------
// The payment method
// ---------------------------------------------------------------------------

test("a paid plan sends the visitor to the provider's page in a popup, and goes on when the popup is done", async () => {
  const open = popupOpens();
  const client = doubleOf();
  const onComplete = vi.fn();
  const probe = await mount(client, { onComplete });
  await started(probe);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();

  expect(open).toHaveBeenCalledWith(
    "https://pay.example.test/setup/chk_mock_1",
    "kaiten-setup",
    expect.any(String),
  );
  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.setup).toMatchObject({
    url: "https://pay.example.test/setup/chk_mock_1",
    opening: "popup",
  });
  expect(probe.now.setupIncomplete).toBe(false);
  expect(probe.now.outcome).toBeNull();

  // The page the visitor lands on in the popup says it is back, and is told someone waits.
  client.completeSetup("chk_mock_1");
  let heard: boolean | undefined;
  await act(async () => {
    void announceReturn("chk_mock_1").then((waited) => (heard = waited));
  });
  await settle(300);

  expect(heard).toBe(true);
  expect(probe.now.step).toBe("awaiting_payment");
  expect(probe.now.payment).toMatchObject({ status: "processing", settlement: "polling" });

  // The first payment settles, and the next read says so.
  client.settlePayment("chk_mock_1");
  await settle(5_000);
  expect(probe.now.step).toBe("completed");
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(probe.now.outcome?.session.customerSlug).toBe("customer-chk_mock_1");
  expect(probe.now.payment?.settlement).toBe("idle");
  expect(probe.now.payment?.status).not.toBe("processing");
});

test("the visitor who says they are back before they saved anything is told so and is not sent away again", async () => {
  const open = popupOpens();
  const client = doubleOf();
  const probe = await mount(client);
  await started(probe);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(open).toHaveBeenCalledTimes(1);

  await act(async () => {
    await probe.now.resume();
  });
  await flush();

  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.setupIncomplete).toBe(true);
  expect(probe.now.problem).toBeNull();
  expect(probe.now.setup?.url).toBe("https://pay.example.test/setup/chk_mock_1");
  expect(open).toHaveBeenCalledTimes(1);
});

test("a blocked popup sends this page itself, and the page loaded back goes on from the session in the address", async () => {
  popupBlocked();
  const navigate = vi.fn();
  const client = doubleOf();
  const first = await mount(client, { navigate });
  await started(first);
  await act(async () => {
    await first.now.confirm();
  });
  await flush();

  expect(navigate).toHaveBeenCalledWith("https://pay.example.test/setup/chk_mock_1");
  expect(first.now.setup?.opening).toBe("redirect");
  // The token is in the client, and in nothing a URL or a log could carry.
  expect(window.location.href).not.toContain("ksc_");
  expect(everythingStored()).not.toContain("ksc_");
  first.unmount();
  cleanup();

  // The provider sends the visitor back to the return URL with the session in the address.
  client.completeSetup("chk_mock_1");
  at("/pricing?plan=growth&kaiten_checkout_session=chk_mock_1");
  const onComplete = vi.fn();
  const back = await mount(client, { onComplete });
  await settle(300);

  expect(back.now.step).toBe("awaiting_payment");
  expect(back.now.quote).toMatchObject({ sessionId: "chk_mock_1", dueToday: { total: 7900 } });
  // The address no longer names the session, and the host's own parameters are left alone.
  expect(window.location.search).toBe("?plan=growth");

  client.settlePayment("chk_mock_1");
  await settle(5_000);
  expect(back.now.step).toBe("completed");
  expect(onComplete).toHaveBeenCalledTimes(1);
});

test("a page loaded back shows the wait at once: no form, and no security check drawn for nothing", async () => {
  popupBlocked();
  const client = doubleOf();
  const first = await mount(client, { navigate: () => {} });
  await started(first);
  await act(async () => {
    await first.now.confirm();
  });
  await flush();
  first.unmount();
  cleanup();
  turnstile.widgets.length = 0;

  client.completeSetup("chk_mock_1");
  at("/pricing?kaiten_checkout_session=chk_mock_1");
  const back = await mount(client);
  // Before the window that sent the visitor away has been waited for.
  expect(back.now.step).toBe("confirming");
  expect(document.querySelector('[data-testid="widget"]')).toBeNull();
  expect(turnstile.widgets).toHaveLength(0);
  await settle(300);
  expect(back.now.step).toBe("awaiting_payment");
  expect(turnstile.widgets).toHaveLength(0);
});

test("a page loaded back, where the provider has no payment method yet, is told so and sent nowhere", async () => {
  const open = popupOpens();
  const client = doubleOf();
  const first = await mount(client);
  await started(first);
  await act(async () => {
    await first.now.confirm();
  });
  await flush();
  first.unmount();
  cleanup();
  open.mockClear();

  at("/pricing?kaiten_checkout_session=chk_mock_1");
  const back = await mount(client);
  await settle(300);

  expect(back.now.step).toBe("awaiting_payment_method");
  expect(back.now.setupIncomplete).toBe(true);
  expect(back.now.setup?.url).toBe("https://pay.example.test/setup/chk_mock_1");
  expect(open).not.toHaveBeenCalled();
});

test("a page that comes back without the token is lost, and starts nothing by itself", async () => {
  const client = doubleOf();
  at("/pricing?kaiten_checkout_session=chk_unknown");
  const probe = await mount(client);
  await settle(300);

  expect(probe.now.step).toBe("lost");
  expect(probe.now.problem).toEqual({ kind: "session_lost" });
  expect(probe.now.error).toBeInstanceOf(CheckoutTokenMissingError);
  expect(callsTo(client, "startCheckout")).toHaveLength(0);
  // The address keeps the session, for a reload that finds the token again.
  expect(window.location.search).toContain("kaiten_checkout_session=chk_unknown");

  // Only the visitor starts again, and the address stops naming the lost session.
  act(() => probe.now.reset());
  await flush();
  expect(probe.now.step).toBe("selecting");
  expect(callsTo(client, "startCheckout")).toHaveLength(0);
  expect(window.location.search).toBe("");
});

test("the popup's own page, once it is told someone waits, does nothing but close", async () => {
  const open = popupOpens();
  const client = doubleOf();
  const opener = await mount(client);
  await started(opener);
  await act(async () => {
    await opener.now.confirm();
  });
  await flush();
  client.completeSetup("chk_mock_1");
  const close = vi.spyOn(window, "close").mockImplementation(() => {});

  // The same page, loaded back in the popup: another mount of the hook, with the same session.
  at("/pricing?kaiten_checkout_session=chk_mock_1");
  const popup = await mount(createMockKaitenAnonymousCheckoutClient());
  await settle(300);

  expect(close).toHaveBeenCalled();
  expect(popup.now.step).toBe("selecting");
  expect(window.location.search).toBe("");
  expect(open).toHaveBeenCalledTimes(1);
  expect(opener.now.step).toBe("awaiting_payment");
});

// ---------------------------------------------------------------------------
// What the visitor is shown, and what changed
// ---------------------------------------------------------------------------

test("a trial used up meanwhile shows the new amount before any payment method is asked for", async () => {
  const open = popupOpens();
  const client = doubleOf(TRIAL_WITH_CARD);
  const probe = await mount(client);
  await started(probe, PRO);
  expect(probe.now.quote).toMatchObject({ dueToday: { total: 0 }, requiresPaymentMethod: true });
  expect(probe.now.quote?.trialEndsAt).not.toBeNull();

  // Another checkout for the same e-mail takes the trial first.
  client.consumeTrial("chk_mock_1");
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();

  expect(probe.now.step).toBe("review");
  expect(open).not.toHaveBeenCalled();
  expect(probe.now.changed?.previous.dueToday.total).toBe(0);
  expect(probe.now.changed?.current).toMatchObject({
    dueToday: { total: 4900 },
    trialEndsAt: null,
    trialRefusedReason: "ALREADY_CONSUMED",
  });
  expect(probe.now.quote).toEqual(probe.now.changed?.current);

  // The visitor has seen it, and confirming again accepts it: the provider's page opens.
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.step).toBe("awaiting_payment_method");
  expect(probe.now.changed).toBeNull();
  expect(open).toHaveBeenCalledTimes(1);
});

test("an amount that changes after the payment method was saved is not confirmed, and nothing is charged", async () => {
  popupOpens();
  const client = doubleOf(TRIAL_WITH_CARD);
  const probe = await mount(client);
  await started(probe, PRO);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  client.completeSetup("chk_mock_1");
  client.consumeTrial("chk_mock_1");

  await act(async () => {
    await probe.now.resume();
  });
  await flush();

  expect(probe.now.step).toBe("review");
  expect(probe.now.problem).toEqual({ kind: "due_today_changed" });
  // The provider's page is behind the visitor: only `awaiting_payment_method` has one.
  expect(probe.now.setup).toBeNull();
  expect(probe.now.setupIncomplete).toBe(false);
  const confirms = callsTo(client, "confirmCheckout").length;
  await act(async () => {
    await probe.now.confirm();
  });
  expect(callsTo(client, "confirmCheckout")).toHaveLength(confirms);

  // The visitor starts again, with a new token.
  act(() => probe.now.reset());
  await flush();
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.problem).toBeNull();
  expect(client.holdsCheckoutSession("chk_mock_1")).toBe(false);
});

// ---------------------------------------------------------------------------
// The payment
// ---------------------------------------------------------------------------

/** A paid checkout whose payment method is saved: the first payment is being made. */
async function payingFor(
  client: MockKaitenAnonymousCheckoutClient,
  options: UseAnonymousCheckoutOptions = {},
) {
  popupOpens();
  const probe = await mount(client, options);
  await started(probe);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  client.completeSetup("chk_mock_1");
  await act(async () => {
    await probe.now.resume();
  });
  await flush();
  expect(probe.now.step).toBe("awaiting_payment");
  return probe;
}

test("the session is read on a schedule while the payment is made, and the payment that needs the visitor is offered", async () => {
  const client = doubleOf();
  const probe = await payingFor(client);
  const reads = () => callsTo(client, "getCheckoutSession").length;
  const first = reads();
  await settle(5_000);
  expect(reads()).toBe(first + 1);

  client.requireAction("chk_mock_1");
  await settle(5_000);
  expect(probe.now.payment).toEqual({
    status: "requires_action",
    hostedInvoiceUrl: "https://pay.example.test/invoice/chk_mock_1",
    settlement: "polling",
  });

  client.failPayment("chk_mock_1");
  await settle(5_000);
  expect(probe.now.payment?.status).toBe("failed");
  expect(probe.now.payment?.hostedInvoiceUrl).toBe("https://pay.example.test/invoice/chk_mock_1");
  expect(probe.now.step).toBe("awaiting_payment");

  // The visitor pays on the page, and the next read says so.
  client.settlePayment("chk_mock_1");
  await settle(5_000);
  expect(probe.now.step).toBe("completed");
  const done = reads();
  await settle(30_000);
  expect(reads()).toBe(done);
});

test("a payment that never settles is given up on, and read again when the window takes focus", async () => {
  const client = doubleOf();
  const probe = await payingFor(client, { pollIntervalMs: 1_000, giveUpAfterMs: 5_000 });
  await settle(6_000);
  expect(probe.now.payment?.settlement).toBe("gave_up");
  const given = callsTo(client, "getCheckoutSession").length;
  await settle(10_000);
  expect(callsTo(client, "getCheckoutSession")).toHaveLength(given);

  client.settlePayment("chk_mock_1");
  act(() => void window.dispatchEvent(new Event("focus")));
  await settle(0);
  expect(probe.now.step).toBe("completed");
});

test("check() reads the session now", async () => {
  const client = doubleOf();
  const probe = await payingFor(client);
  client.settlePayment("chk_mock_1");
  act(() => probe.now.check());
  await settle(0);
  expect(probe.now.step).toBe("completed");
});

test("a payment that never comes closes the session as expired, and the visitor can start again", async () => {
  const client = doubleOf();
  const probe = await payingFor(client);
  client.expire("chk_mock_1");
  await settle(5_000);

  expect(probe.now.step).toBe("closed");
  expect(probe.now.closedAs).toBe("EXPIRED");
  expect(probe.now.outcome).toBeNull();

  act(() => probe.now.reset());
  await flush();
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.closedAs).toBeNull();
  expect(probe.now.selection).toMatchObject({ priceId: GROWTH, email: EMAIL });
  expect(probe.now.canStart).toBe(true);
});

test("a session left open and abandoned is told apart when it is confirmed", async () => {
  const client = doubleOf();
  const probe = await mount(client);
  await started(probe);
  client.abandon("chk_mock_1");
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.step).toBe("closed");
  expect(probe.now.closedAs).toBe("ABANDONED");
  expect(probe.now.problem).toBeNull();
});

test("a checkout that completed while the visitor was away is a success, not a refusal", async () => {
  popupBlocked();
  const client = doubleOf();
  const first = await mount(client, { navigate: vi.fn() });
  await started(first);
  await act(async () => {
    await first.now.confirm();
  });
  await flush();
  first.unmount();
  cleanup();
  client.completeSetup("chk_mock_1");
  // Kaiten completes a checkout whose visitor never came back.
  const onComplete = vi.fn();
  at("/pricing?kaiten_checkout_session=chk_mock_1");
  const back = await mount(client, { onComplete });
  await settle(300);
  client.settlePayment("chk_mock_1");
  await settle(5_000);
  expect(back.now.step).toBe("completed");
  back.unmount();
  cleanup();

  // A reload after it closed finds the outcome without asking for anything to be done.
  at("/pricing?kaiten_checkout_session=chk_mock_1");
  const again = await mount(client);
  await settle(300);
  expect(again.now.step).toBe("completed");
  expect(again.now.outcome?.session.status).toBe("COMPLETED");
  expect(callsTo(client, "startCheckout")).toHaveLength(1);
});

test("starting over is refused while a call is in flight, a payment is made, or the checkout completed", async () => {
  const client = doubleOf();
  const probe = await payingFor(client);
  act(() => probe.now.reset());
  expect(probe.now.step).toBe("awaiting_payment");
  expect(client.holdsCheckoutSession("chk_mock_1")).toBe(true);

  client.settlePayment("chk_mock_1");
  await settle(5_000);
  expect(probe.now.step).toBe("completed");
  act(() => probe.now.reset());
  expect(probe.now.step).toBe("completed");
  expect(client.holdsCheckoutSession("chk_mock_1")).toBe(true);
});

test("starting over closes the popup the provider's page is in, so a card saved there completes nothing", async () => {
  const close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({
    opener: window,
    close,
    closed: false,
  } as unknown as Window);
  const client = doubleOf();
  const probe = await mount(client);
  await started(probe);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.setup?.opening).toBe("popup");
  expect(close).not.toHaveBeenCalled();

  act(() => probe.now.reset());
  await flush();

  expect(close).toHaveBeenCalledTimes(1);
  expect(probe.now.step).toBe("selecting");
  expect(probe.now.setup).toBeNull();
  // The session is forgotten with it: a page loaded back to it would find no token.
  expect(client.holdsCheckoutSession("chk_mock_1")).toBe(false);
});

test("a confirm that fails for want of a network leaves the visitor where they were, to try again", async () => {
  const client = createMockKaitenAnonymousCheckoutClient({
    fail: {
      confirmCheckout: (call) => (call === 1 ? new KaitenNetworkError("offline") : undefined),
    },
  });
  const probe = await mount(client);
  await started(probe, STARTER);
  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.step).toBe("review");
  expect(probe.now.problem).toEqual({ kind: "network" });

  await act(async () => {
    await probe.now.confirm();
  });
  await flush();
  expect(probe.now.step).toBe("completed");
  expect(probe.now.problem).toBeNull();
});

test("nothing is read once the page is gone", async () => {
  const client = doubleOf();
  const probe = await payingFor(client);
  probe.unmount();
  const reads = callsTo(client, "getCheckoutSession").length;
  await settle(60_000);
  expect(callsTo(client, "getCheckoutSession")).toHaveLength(reads);
});

test("the token of the checkout is in no URL and no storage this hook writes", async () => {
  const client = doubleOf();
  const probe = await mount(client);
  act(() => probe.now.setName("Ada"));
  await started(probe);
  expect(everythingStored()).not.toContain("ksc_");
  expect(window.location.href).not.toContain("ksc_");
  // What it does write is the name, under the session, for the page that asked for it.
  expect(
    JSON.parse(window.sessionStorage.getItem("kaiten:pending:anonymous-checkout")!),
  ).toMatchObject({
    sessionId: "chk_mock_1",
    data: { name: "Ada" },
  });
});

test("a name left empty is not kept", async () => {
  const probe = await mount(doubleOf());
  await started(probe);
  expect(window.sessionStorage.getItem("kaiten:pending:anonymous-checkout")).toBeNull();
});

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

test("under mode=public the catalogue is read, and the checkout is offered once it says so", async () => {
  const catalogClient = createMockKaitenClient({ catalog: anonymousCatalog(), delayMs: 50 });
  const seen: { current?: UseAnonymousCheckoutResult } = {};
  function Probe() {
    seen.current = useAnonymousCheckout();
    return null;
  }
  render(
    <KaitenProvider
      mode="public"
      publishableKey={`pk_${"a".repeat(43)}`}
      client={catalogClient}
      anonymousCheckoutClient={doubleOf()}
      polling={{ enabled: false }}
    >
      <Probe />
    </KaitenProvider>,
  );
  await flush();
  expect(seen.current!.isLoading).toBe(true);
  expect(seen.current!.available).toBe(false);
  await settle(100);
  expect(seen.current!.isLoading).toBe(false);
  expect(seen.current!.available).toBe(true);
});

test("a customer session is not a visitor: the checkout client it is given is ignored", async () => {
  const seen: { current?: UseAnonymousCheckoutResult } = {};
  function Probe() {
    seen.current = useAnonymousCheckout();
    return null;
  }
  render(
    // Not in the types of that mode, and so not something to rely on: what a host that spreads props
    // into the provider would do.
    <KaitenProvider
      {...({
        mode: "customer-session",
        sessionClient: createMockKaitenSessionClient(),
        anonymousCheckoutClient: doubleOf(),
        polling: { enabled: false },
      } as unknown as Parameters<typeof KaitenProvider>[0])}
    >
      <Probe />
    </KaitenProvider>,
  );
  await settle(10);
  expect(seen.current!.available).toBe(false);
});
