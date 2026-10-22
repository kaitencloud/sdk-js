// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// A visitor's checkout, drawn: what they choose and type, the security check, what the server says is
// due, the payment provider's page and the way back from it. The client is the double of the
// anonymous checkout and the security check a stand-in for Cloudflare's script, and the hook under the
// component is the real one: what is pinned is what a visitor sees and what reaches the API. The
// stories play the whole of each situation in a browser; these hold what a browser need not.

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { CheckoutTokenMissingError, KaitenError } from "@kaitencloud/client";
import { createMockKaitenAnonymousCheckoutClient } from "@kaitencloud/client/testing";
import { fr } from "@kaitencloud/react/locales";

import {
  anonymousCheckoutDecorator,
  enterprise,
  growth,
  latestAnonymousClient,
  lite,
  starter,
  type StoryAnonymousOptions,
} from "../.storybook/anonymous-checkout-mock.tsx";
import { installTurnstileDouble, TURNSTILE_TEST_KEYS } from "../.storybook/turnstile-double.ts";
import {
  AnonymousCheckoutFlow,
  KaitenProvider,
  KaitenStyleRoot,
  type AnonymousCheckoutFlowProps,
  type KaitenCatalog,
} from "../src/index.ts";

const EMAIL = "ada@example.com";

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/pricing?plan=growth");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The flow in the situation `options` script. */
function mount(
  props: AnonymousCheckoutFlowProps = { plan: growth },
  options: StoryAnonymousOptions = {},
  locale?: Parameters<typeof anonymousCheckoutDecorator>[1],
) {
  const Decorated = anonymousCheckoutDecorator(options, locale);
  return render(Decorated(() => <AnonymousCheckoutFlow {...props} />));
}

const email = () => screen.getByLabelText("Email") as HTMLInputElement;
const passed = () => screen.findByText("Security check passed.");
const go = (name: string | RegExp = "Continue") => screen.getByRole("button", { name });
const off = (element: Element) =>
  (element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true";

async function fillIn(address = EMAIL) {
  await passed();
  fireEvent.change(email(), { target: { value: address } });
}

/** A provider of a page that sells to visitors, on a client of the test's own and the stand-in for the check. */
function plainProvider(
  client: ReturnType<typeof createMockKaitenAnonymousCheckoutClient>,
  appearance?: React.ComponentProps<typeof KaitenStyleRoot>["appearance"],
) {
  const catalog: KaitenCatalog = {
    plans: [growth, starter],
    capabilities: {
      checkout: true,
      paymentMethods: true,
      anonymousCheckout: true,
      turnstileSiteKey: TURNSTILE_TEST_KEYS.alwaysPasses,
    },
  };
  return (ui: React.ReactNode) => (
    <KaitenProvider mode="static" catalog={catalog} anonymousCheckoutClient={client}>
      <KaitenStyleRoot appearance={appearance}>{ui}</KaitenStyleRoot>
    </KaitenProvider>
  );
}

describe("choosing", () => {
  test("the form asks for an email and a security check, and nothing it does not need", async () => {
    mount();
    await passed();
    expect(screen.getByRole("group", { name: "Security check" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Billing interval" })).toBeTruthy();
    expect(email().getAttribute("type")).toBe("email");
    expect(email().getAttribute("autocomplete")).toBe("email");
    expect(email().required).toBe(true);
    // The hint is the field's description, so that it is read with it.
    const describedBy = email().getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toMatch(
      /Your receipt and the next steps/,
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(off(go())).toBe(true);
  });

  test("the button waits for a plausible address as well as for the security check", async () => {
    mount();
    await passed();
    fireEvent.change(email(), { target: { value: "ada@" } });
    expect(email().getAttribute("aria-invalid")).toBe("true");
    expect(off(go())).toBe(true);
    fireEvent.change(email(), { target: { value: EMAIL } });
    expect(email().getAttribute("aria-invalid")).toBeNull();
    await waitFor(() => expect(off(go())).toBe(false));
  });

  test("the name is asked for when the page says so, and it is the page's alone", async () => {
    const onStarted = vi.fn();
    mount({ plan: starter, collectName: true, onStarted });
    await fillIn();
    expect((screen.getByLabelText("Name") as HTMLInputElement).required).toBe(true);
    expect(off(go("Start for free"))).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(go("Start for free"));
    await screen.findByText("You're subscribed");
    expect(onStarted).toHaveBeenCalledWith({
      sessionId: "chk_mock_1",
      email: EMAIL,
      name: "Ada Lovelace",
    });
    const sent = latestAnonymousClient().calls.flatMap((call) => JSON.stringify(call.args));
    expect(sent.join()).not.toContain("Ada Lovelace");
  });

  test("submitting the form starts the checkout once, as pressing the button does", async () => {
    mount({ plan: starter });
    await fillIn();
    const form = email().closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await screen.findByText("You're subscribed");
    expect(
      latestAnonymousClient().calls.filter((call) => call.method === "startCheckout"),
    ).toHaveLength(1);
  });

  test("a form that is not ready is not submitted", async () => {
    mount({ plan: starter });
    await passed();
    fireEvent.submit(email().closest("form")!);
    expect(latestAnonymousClient().calls).toHaveLength(0);
  });

  test("the period chosen is the price started", async () => {
    mount();
    await fillIn();
    fireEvent.click(screen.getByRole("radio", { name: "$790.00/year" }));
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    const start = latestAnonymousClient().calls.find((call) => call.method === "startCheckout");
    expect(start?.args[0]).toMatchObject({ priceId: "price_growth_annual", email: EMAIL });
    expect(screen.getAllByText("$790.00").length).toBeGreaterThan(0);
  });

  test("a plan with a single price has no period to choose", async () => {
    mount({ plan: lite });
    await passed();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  test("a plan that is not sold online says so and offers only the way to ask", async () => {
    mount({ plan: enterprise });
    await screen.findByText("This plan isn't sold online. Contact us to get it.");
    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
      "https://example.test/contact",
    );
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  test("a plan whose way to ask is not a web address is not offered one", async () => {
    mount({ plan: { ...enterprise, selfServeCtaUrl: "javascript:alert(1)" } });
    await screen.findByText("This plan isn't sold online. Contact us to get it.");
    expect(screen.queryByRole("link", { name: "Contact us" })).toBeNull();
  });

  test("a plan with no price to buy says it cannot be bought online", async () => {
    mount({ plan: { ...growth, billingPrices: [] } });
    await screen.findByText("This plan can't be bought online.");
  });

  test("nothing is drawn without a plan to sell, or when the key cannot start a checkout", async () => {
    const view = mount({}, {});
    await act(async () => {});
    expect(view.container.querySelector('[data-slot="anonymous-checkout-flow"]')).toBeNull();
    cleanup();
    const off = mount({ plan: growth }, { off: true });
    await act(async () => {});
    expect(off.container.querySelector('[data-slot="anonymous-checkout-flow"]')).toBeNull();
  });
});

describe("the security check", () => {
  test("a check that is not passed keeps the button off, and says so", async () => {
    mount({ plan: starter }, { widget: "never" });
    fireEvent.change(email(), { target: { value: EMAIL } });
    expect(await screen.findByText("Running the security check...")).toBeTruthy();
    expect(off(go("Start for free"))).toBe(true);
    expect(
      screen.getByText("The button is available once the security check passes."),
    ).toBeTruthy();
  });

  test("a check that cannot run says what to allow, and can be run again", async () => {
    mount({ plan: starter }, { widget: "blocks" });
    expect(await screen.findByText(/allow challenges\.cloudflare\.com/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/security check could not load/);
    expect(off(screen.getByRole("button", { name: "Try the check again" }))).toBe(false);
  });

  test("the widget is drawn with the site key the catalogue gave, and the colour of the page", async () => {
    const uninstall = installTurnstileDouble();
    const draw = vi.spyOn(
      (globalThis as unknown as { turnstile: { render: (...args: unknown[]) => unknown } })
        .turnstile,
      "render",
    );
    const client = createMockKaitenAnonymousCheckoutClient();
    try {
      // Nothing declares a colour: the host's own `.dark` is followed, else the system's.
      render(plainProvider(client)(<AnonymousCheckoutFlow plan={starter} />));
      await passed();
      expect(draw.mock.calls[0]![1]).toMatchObject({
        sitekey: TURNSTILE_TEST_KEYS.alwaysPasses,
        theme: "auto",
        appearance: "always",
      });
      cleanup();

      document.documentElement.classList.add("dark");
      draw.mockClear();
      render(plainProvider(client)(<AnonymousCheckoutFlow plan={starter} />));
      await passed();
      expect(draw.mock.calls[0]![1]).toMatchObject({ theme: "dark" });
      cleanup();

      // A colour the style root declares wins.
      draw.mockClear();
      render(
        plainProvider(client, { baseTheme: "light" })(<AnonymousCheckoutFlow plan={starter} />),
      );
      await passed();
      expect(draw.mock.calls[0]![1]).toMatchObject({ theme: "light" });
    } finally {
      document.documentElement.classList.remove("dark");
      uninstall();
    }
  });
});

describe("what is due", () => {
  test("the review says who it is for, and what the server says is due", async () => {
    mount();
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(screen.getByText("Due today")).toBeTruthy();
    expect(screen.getAllByText("$79.00").length).toBeGreaterThan(0);
    expect(off(go("Continue to payment"))).toBe(false);
    // Nothing that sums a price is on the page: the totals are the double's own.
    expect(screen.queryByText("No payment method is asked for.")).toBeNull();
  });

  test("a free plan has nothing to review: one press starts and confirms it", async () => {
    mount({ plan: starter });
    await fillIn();
    fireEvent.click(go("Start for free"));
    await screen.findByText("You're subscribed");
    const calls = latestAnonymousClient().calls.map((call) => call.method);
    expect(calls).toEqual(["startCheckout", "confirmCheckout"]);
    expect(screen.getByText("Nothing is due today.")).toBeTruthy();
    // Told what happens next, since the host gave no page to go on to.
    expect(
      screen.getByText("Check ada@example.com: we'll write to you there with what to do next."),
    ).toBeTruthy();
  });

  test("a free plan the server prices at something is reviewed, not confirmed behind the visitor's back", async () => {
    // The catalogue says Starter is free, and the server says it is not: the visitor is shown it.
    const priced = {
      ...starter,
      billingPrices: [{ ...starter.billingPrices![0]!, id: "price_growth_monthly", amount: 0 }],
    };
    mount({ plan: priced });
    await fillIn();
    fireEvent.click(go("Start for free"));
    await screen.findByText(`For ${EMAIL}`);
    expect(screen.getAllByText("$79.00").length).toBeGreaterThan(0);
    expect(latestAnonymousClient().calls.map((call) => call.method)).toEqual(["startCheckout"]);
  });

  test("a trial that asks for no card is reviewed and started on the visitor's word", async () => {
    mount({ plan: lite });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(await screen.findByText("$0.00 today")).toBeTruthy();
    expect(off(go("Start free trial"))).toBe(false);
    expect(latestAnonymousClient().calls.map((call) => call.method)).toEqual(["startCheckout"]);
    fireEvent.click(go("Start free trial"));
    await screen.findByText("You're subscribed");
    expect(screen.getAllByText(/^Trial ends on /).length).toBeGreaterThan(0);
  });

  test("changing the choices from the review goes back to the form with a security check to pass", async () => {
    mount();
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    fireEvent.click(go("Change my choices"));
    expect(((await screen.findByLabelText("Email")) as HTMLInputElement).value).toBe(EMAIL);
    await passed();
    await waitFor(() => expect(off(go())).toBe(false));
    // The session that was left is not read or confirmed again.
    expect(latestAnonymousClient().holdsCheckoutSession("chk_mock_1")).toBe(false);
  });
});

describe("the keyboard", () => {
  test("follows the steps: to the review, back to the form, and to a refusal", async () => {
    mount();
    await fillIn();
    fireEvent.click(go());
    const review = await screen.findByText(`For ${EMAIL}`);
    await waitFor(() => expect(document.activeElement).toBe(review));

    fireEvent.click(go("Change my choices"));
    await waitFor(() => expect(document.activeElement).toBe(email()));
  });

  test("goes to the sentence that says what was refused", async () => {
    const Decorated = anonymousCheckoutDecorator({
      fail: {
        startCheckout: new KaitenError({
          title: "not public",
          status: 422,
          code: "CreateCheckoutSession.PriceNotPublic",
        }),
      },
    });
    render(Decorated(() => <AnonymousCheckoutFlow plan={growth} />));
    await fillIn();
    fireEvent.click(go());
    const refusal = await screen.findByText("This plan can't be bought right now.");
    await waitFor(() => expect(document.activeElement).toBe(refusal));
    expect(refusal.getAttribute("role")).toBe("alert");
  });
});

describe("what happens next", () => {
  const bought: StoryAnonymousOptions = { visitor: "saves", payment: "paid" };

  async function buy(props: AnonymousCheckoutFlowProps) {
    mount(props, bought);
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    fireEvent.click(go("Continue to payment"));
    await screen.findByText("You're subscribed", {}, { timeout: 4_000 });
  }

  test("the host's page is offered when it gave one, and the receipt of what was paid", async () => {
    await buy({ plan: growth, successUrl: "https://shop.example.test/welcome" });
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
      "https://shop.example.test/welcome",
    );
    expect(screen.getByText("Payment received.")).toBeTruthy();
    expect(screen.queryByText(/Check ada@example\.com/)).toBeNull();
  });

  test("a page of the host's own site is offered as it is written", async () => {
    await buy({ plan: growth, successUrl: "/welcome?plan=growth" });
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
      "/welcome?plan=growth",
    );
  });

  test.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.test/"])(
    "%s is not a place to send a visitor: they are told to check their email instead",
    async (successUrl) => {
      await buy({ plan: growth, successUrl });
      expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
      expect(screen.getByText(/Check ada@example\.com/)).toBeTruthy();
    },
  );

  test("the host is told once, with the session and the reference it gave", async () => {
    const onComplete = vi.fn();
    await buy({ plan: growth, onComplete, clientReferenceId: "cart-42" });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toMatchObject({
      sessionId: "chk_mock_1",
      clientReferenceId: "cart-42",
      session: { status: "COMPLETED", email: EMAIL },
    });
  });
});

describe("coming back from the payment provider", () => {
  test("a page with no plan finds it from the session, and sees the checkout through", async () => {
    const uninstall = installTurnstileDouble();
    const client = createMockKaitenAnonymousCheckoutClient();
    const started = await client.startCheckout({
      turnstileToken: "t",
      priceId: "price_growth_monthly",
      email: EMAIL,
      returnUrl: "https://shop.example.test/welcome",
    });
    await client.confirmCheckout(started.sessionId);
    client.completeSetup(started.sessionId);
    window.history.replaceState(null, "", `/welcome?kaiten_checkout_session=${started.sessionId}`);

    const onComplete = vi.fn();
    render(plainProvider(client)(<AnonymousCheckoutFlow onComplete={onComplete} />));
    // The plan is the session's, by its price: the title says so.
    expect(await screen.findByText("Growth", {}, { timeout: 2_000 })).toBeTruthy();
    await screen.findByText(
      "Your plan starts once your payment is confirmed.",
      {},
      { timeout: 4_000 },
    );
    expect(window.location.search).toBe("");

    client.settlePayment(started.sessionId);
    act(() => void window.dispatchEvent(new Event("focus")));
    uninstall();
  });

  test("a page that comes back without the token says the checkout may have gone through", async () => {
    const uninstall = installTurnstileDouble();
    const client = createMockKaitenAnonymousCheckoutClient();
    window.history.replaceState(null, "", "/welcome?kaiten_checkout_session=chk_gone");
    render(plainProvider(client)(<AnonymousCheckoutFlow plan={growth} />));
    await screen.findByText("We can't find this checkout in this browser.", {}, { timeout: 2_000 });
    expect(screen.getByText(/If you already paid, there is nothing more to do/)).toBeTruthy();
    expect(off(screen.getByRole("button", { name: "Start a new checkout" }))).toBe(false);
    // Nothing was started, and the double was asked once, for the session in the address.
    expect(client.calls.map((call) => call.method)).toEqual(["confirmCheckout"]);
    expect(new CheckoutTokenMissingError("x")).toBeInstanceOf(Error);
    uninstall();
  });
});

describe("markup", () => {
  test("unstyled draws plain markup with the slots to be styled by", async () => {
    const view = mount({ plan: starter, unstyled: true });
    await passed();
    const root = view.container.querySelector('[data-slot="anonymous-checkout-flow"]')!;
    expect(root.tagName).toBe("SECTION");
    expect(root.querySelector("form")).not.toBeNull();
    expect(root.querySelector('[data-slot="anonymous-checkout-email"] input')).not.toBeNull();
    expect(root.querySelector('[data-slot="anonymous-checkout-turnstile"]')).not.toBeNull();
    expect(root.querySelector('[data-slot="card"]')).toBeNull();
    expect(
      within(root as HTMLElement).getByRole("button", { name: "Start for free" }),
    ).toBeTruthy();
  });

  test("the words are the language's", async () => {
    mount({ plan: starter }, {}, fr);
    await screen.findByText("Contrôle de sécurité réussi.");
    expect(screen.getByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Commencer gratuitement" })).toBeTruthy();
  });
});
