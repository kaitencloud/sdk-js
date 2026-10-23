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
import {
  CheckoutTokenMissingError,
  KaitenError,
  ProviderUnavailableError,
  TurnstileFailedError,
} from "@kaitencloud/client";
import { createMockKaitenAnonymousCheckoutClient } from "@kaitencloud/client/testing";
import { fr } from "@kaitencloud/react/locales";

import {
  anonymousCheckoutDecorator,
  enterprise,
  growth,
  latestAnonymousClient,
  lite,
  pro,
  starter,
  type StoryAnonymousOptions,
} from "../.storybook/anonymous-checkout-mock.tsx";
import { installTurnstileDouble, TURNSTILE_TEST_KEYS } from "../.storybook/turnstile-double.ts";
import {
  AnonymousCheckoutFlow,
  formatKaitenDate,
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
      /used for your account and your billing/,
    );
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(off(go())).toBe(true);
  });

  test("the button waits for a plausible address as well as for the security check", async () => {
    mount();
    await passed();
    fireEvent.change(email(), { target: { value: "ada@" } });
    // Not told off while still typing it.
    expect(email().getAttribute("aria-invalid")).toBeNull();
    expect(off(go())).toBe(true);
    fireEvent.blur(email());
    expect(email().getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(email(), { target: { value: EMAIL } });
    expect(email().getAttribute("aria-invalid")).toBeNull();
    await waitFor(() => expect(off(go())).toBe(false));
  });

  test("a bad address is said in words, tied to the field, and pressing the button says it too", async () => {
    mount();
    await passed();
    fireEvent.change(email(), { target: { value: "ada@" } });
    fireEvent.blur(email());
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("This email address isn't valid.");
    expect(email().getAttribute("aria-describedby")).toContain(alert.id);
    // The button is dimmed but not removed from the keyboard, and pressing it takes the visitor to the field.
    expect(go().getAttribute("aria-disabled")).toBe("true");
    expect((go() as HTMLButtonElement).disabled).toBe(false);
    email().blur();
    fireEvent.click(go());
    expect(document.activeElement).toBe(email());
    expect(latestAnonymousClient().calls).toHaveLength(0);
  });

  test("Enter in an empty address field says what is wrong instead of nothing", async () => {
    mount();
    await passed();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.submit(email().closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("This email address isn't valid.");
    expect(document.activeElement).toBe(email());
  });

  test("a name asked for and missing is said in words too", async () => {
    mount({ plan: starter, collectName: true });
    await fillIn();
    fireEvent.click(go("Start for free"));
    expect(screen.getByRole("alert").textContent).toBe("Enter your name.");
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
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

  test("the button that is not available can be pressed by a mouse or a finger, to be told what is missing", async () => {
    mount();
    await passed();
    // The base style takes a press away from any control that is `aria-disabled`; this one asks for it back.
    expect(go().className).toContain("aria-disabled:pointer-events-auto");
    expect(go().className).not.toContain("aria-disabled:pointer-events-none");
  });

  test("a button that waits for its answer cannot be pressed again", async () => {
    mount({ plan: starter }, { delayMs: 200 });
    await fillIn();
    fireEvent.click(go("Start for free"));
    const busy = await screen.findByRole("button", { name: /Processing/ });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(busy.className).toContain("aria-disabled:pointer-events-none");
    expect(busy.className).not.toContain("pointer-events-auto");
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

  test("the note about the card is for a plan that goes to the provider's page, not for a trial that asks for none", async () => {
    const note = /handled by the payment provider/;
    mount({ plan: growth });
    await passed();
    expect(screen.getByText(note)).toBeTruthy();
    cleanup();
    mount({ plan: lite });
    await passed();
    expect(screen.queryByText(note)).toBeNull();
  });

  test("a plan that is not sold online says so and offers only the way to ask", async () => {
    mount({ plan: enterprise });
    await screen.findByText("This plan isn't sold online. Contact us to get it.");
    expect(screen.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
      "https://example.test/contact",
    );
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  test("a plan sold by contact with no price on the page is still sold by contact, and leads back", async () => {
    const onCancel = vi.fn();
    mount({ plan: { ...enterprise, billingPrices: [], prices: [] }, onCancel });
    await screen.findByText("This plan isn't sold online. Contact us to get it.");
    expect(screen.queryByText("This plan can't be bought online.")).toBeNull();
    expect(screen.getByRole("link", { name: "Contact us" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("a plan whose way to ask is not a web address is not offered one", async () => {
    mount({ plan: { ...enterprise, selfServeCtaUrl: "javascript:alert(1)" } });
    await screen.findByText("This plan isn't sold online. Contact us to get it.");
    expect(screen.queryByRole("link", { name: "Contact us" })).toBeNull();
  });

  test("a plan with no price to buy says it cannot be bought online, and leads back when the page can", async () => {
    const onCancel = vi.fn();
    mount({ plan: { ...growth, billingPrices: [] }, onCancel });
    await screen.findByText("This plan can't be bought online.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ plan: { ...growth, billingPrices: [] } });
    await screen.findByText("This plan can't be bought online.");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
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
    expect(await screen.findByText("Running the security check…")).toBeTruthy();
    expect(off(go("Start for free"))).toBe(true);
    expect(
      screen.getByText("The button is available once the security check passes."),
    ).toBeTruthy();
  });

  test("a check that cannot run says what to allow, and can be run again", async () => {
    mount({ plan: starter }, { widget: "unloadable" });
    expect(await screen.findByText(/allow challenges\.cloudflare\.com/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/security check could not load/);
    expect(off(screen.getByRole("button", { name: "Try the check again" }))).toBe(false);
  });

  test("a check that loaded and failed does not blame what the visitor blocked", async () => {
    mount({ plan: starter }, { widget: "blocks" });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The security check failed. Try it again.");
    expect(screen.queryByText(/challenges\.cloudflare\.com/)).toBeNull();
    expect(off(screen.getByRole("button", { name: "Try the check again" }))).toBe(false);
  });

  test("a check that passed is not said so beside the refusal of the start that used it", async () => {
    const refused = new TurnstileFailedError({
      title: "turnstile",
      status: 422,
      code: "CreateCheckoutSession.TurnstileFailed",
    });
    mount(
      { plan: starter },
      { fail: { startCheckout: (call) => (call === 1 ? refused : undefined) } },
    );
    await fillIn();
    expect(screen.getByText("Security check passed.")).toBeTruthy();

    fireEvent.click(go("Start for free"));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "We couldn't verify the security check. Please complete it again.",
    );
    // A new check was passed behind the refusal, and the button is back; the sentence is not.
    await waitFor(() => expect(off(go("Start for free"))).toBe(false));
    expect(screen.queryByText("Security check passed.")).toBeNull();
  });

  test("a check that cannot run keeps no room for a widget that is not drawn, and the button points at why", async () => {
    mount({ plan: starter }, { widget: "unloadable" });
    const alert = await screen.findByRole("alert");
    const room = document.querySelector('[data-slot="anonymous-checkout-turnstile"]')!;
    expect(room.className).not.toMatch(/min-h-/);
    // The button is described by the sentence that says the check failed.
    fireEvent.change(email(), { target: { value: EMAIL } });
    expect(go("Start for free").getAttribute("aria-describedby")).toContain(alert.id);
  });

  test("while it runs the room for the widget is kept, so that the form does not jump", async () => {
    mount({ plan: starter }, { widget: "never" });
    await screen.findByText("Running the security check…");
    expect(document.querySelector('[data-slot="anonymous-checkout-turnstile"]')!.className).toMatch(
      /min-h-/,
    );
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
    expect(screen.getByText("Your order is registered for ada@example.com.")).toBeTruthy();
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

  test("a trial that asks for a card says what it will bill and from when, from the catalogue's price", async () => {
    mount({ plan: pro });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(await screen.findByText("$0.00 today")).toBeTruthy();
    expect(
      screen.getByText(/^Then \$49\.00\/month from .+, unless you cancel before\.$/),
    ).toBeTruthy();
  });

  test("a paid plan names its price as the card does, with its period, and when it renews", async () => {
    mount();
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);

    // The server's arithmetic is in its own format ("1 × 79.00 USD"); the amount is the card's.
    expect(screen.queryByText(/1 × /)).toBeNull();
    expect(screen.queryByText(/79\.00 USD/)).toBeNull();
    const renews = new Date("2026-01-15T09:00:00.000Z");
    renews.setUTCMonth(renews.getUTCMonth() + 1);
    expect(screen.getByText(`Renews at $79.00/month on ${formatKaitenDate(renews)}.`)).toBeTruthy();
  });

  test("a yearly period says it is yearly", async () => {
    mount();
    await passed();
    fireEvent.click(screen.getByRole("radio", { name: /\$790\.00\/year/ }));
    fireEvent.change(email(), { target: { value: EMAIL } });
    await waitFor(() => expect(off(go())).toBe(false));
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);

    const renews = new Date("2026-01-15T09:00:00.000Z");
    renews.setUTCMonth(renews.getUTCMonth() + 12);
    expect(screen.getByText(`Renews at $790.00/year on ${formatKaitenDate(renews)}.`)).toBeTruthy();
  });

  test("a trial that asks for a card does not say it renews: it says what follows the trial", async () => {
    mount({ plan: pro });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(screen.queryByText(/^Renews at /)).toBeNull();
  });

  test("a trial that asks for no card says nothing is charged unless the visitor adds one, in the review and after", async () => {
    mount({ plan: lite });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    const said = "No payment method is asked for. Nothing is charged unless you add one.";
    expect(screen.getByText(said)).toBeTruthy();
    expect(screen.queryByText("No payment method is asked for.")).toBeNull();

    fireEvent.click(go("Start free trial"));
    await screen.findByText("You're subscribed");
    expect(screen.getByText(said)).toBeTruthy();
  });

  test("a free plan only says no payment method is asked for", async () => {
    mount({ plan: starter });
    await fillIn();
    fireEvent.click(go("Start for free"));
    await screen.findByText("You're subscribed");
    expect(screen.queryByText(/Nothing is charged unless/)).toBeNull();
  });

  test("an amount that changed is a warning that is not skimmed past, announced as a status and focused", async () => {
    mount({ plan: pro });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    // Another checkout for the same email takes the trial first.
    latestAnonymousClient().consumeTrial("chk_mock_1");
    fireEvent.click(go("Continue to payment"));

    const changed = await screen.findByText(/The amount due changed from \$0\.00 to \$49\.00/);
    expect(changed.getAttribute("data-tone")).toBe("warning");
    expect(changed.getAttribute("role")).toBe("status");
    await waitFor(() => expect(document.activeElement).toBe(changed));
  });

  test("a trial that asks for no card does not promise a charge", async () => {
    mount({ plan: lite });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(screen.queryByText(/^Then /)).toBeNull();
  });

  test("an amount that changed after the payment method was saved is not drawn as what is due", async () => {
    // The visitor saves the card in the popup a moment after it opens, and the trial is used up first.
    mount({ plan: pro }, { visitor: "saves" });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    expect(await screen.findByText("$0.00 today")).toBeTruthy();
    expect(screen.getByText(/^Then \$49\.00\/month from /)).toBeTruthy();
    fireEvent.click(go("Continue to payment"));
    await screen.findByText(/Save your payment method in the window we opened/);
    latestAnonymousClient().consumeTrial("chk_mock_1");

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toMatch(/amount due changed after your payment method was saved/);
    // What the visitor was shown is not what is due now, and is not drawn as if it were.
    expect(screen.queryByText("$0.00 today")).toBeNull();
    expect(screen.queryByText(/^Then \$49\.00/)).toBeNull();
    expect(screen.getByRole("button", { name: "Start again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to payment" })).toBeNull();
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

describe("one checkout for one plan", () => {
  test("another plan is another checkout, from the start; the same plan drawn again is the same one", async () => {
    const client = createMockKaitenAnonymousCheckoutClient();
    const uninstall = installTurnstileDouble();
    const view = render(plainProvider(client)(<AnonymousCheckoutFlow plan={growth} />));
    await fillIn();
    expect(email().value).toBe(EMAIL);

    // The same plan with another prop: the checkout goes on, and so does what was typed.
    view.rerender(
      plainProvider(client)(<AnonymousCheckoutFlow plan={growth} onCancel={() => {}} />),
    );
    expect(email().value).toBe(EMAIL);

    view.rerender(plainProvider(client)(<AnonymousCheckoutFlow plan={starter} />));
    await waitFor(() => expect(email().value).toBe(""));
    uninstall();
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
    expect(screen.queryByText(/registered for ada@example\.com/)).toBeNull();
  });

  test("a page of the host's own site is offered as it is written", async () => {
    await buy({ plan: growth, successUrl: "/welcome?plan=growth" });
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(
      "/welcome?plan=growth",
    );
  });

  test.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.test/"])(
    "%s is not a place to send a visitor: they are told the order is registered instead",
    async (successUrl) => {
      await buy({ plan: growth, successUrl });
      expect(screen.queryByRole("link", { name: "Continue" })).toBeNull();
      expect(screen.getByText(/registered for ada@example\.com/)).toBeTruthy();
    },
  );

  test("the host is told once, with the session and the reference it gave", async () => {
    const onSubscribed = vi.fn();
    await buy({ plan: growth, onSubscribed, clientReferenceId: "cart-42" });
    await waitFor(() => expect(onSubscribed).toHaveBeenCalledTimes(1));
    expect(onSubscribed.mock.calls[0]![0]).toMatchObject({
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

    const onSubscribed = vi.fn();
    render(plainProvider(client)(<AnonymousCheckoutFlow onSubscribed={onSubscribed} />));
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
    // From the first frame the page says it is reading the checkout: not the form of a visitor who has not paid.
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    await screen.findByText("We can't find this checkout in this browser.", {}, { timeout: 2_000 });
    expect(screen.getByText(/If you already paid, please don't pay again/)).toBeTruthy();
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

describe("what the visitor is told", () => {
  const LONG_EMAIL = "ada.lovelace.with.a.very.long.address@subdomain.example-company.test";

  test("a provider that cannot be reached is said once, with the wait", async () => {
    const Decorated = anonymousCheckoutDecorator({
      fail: {
        startCheckout: new ProviderUnavailableError(
          { title: "unavailable", status: 503, code: "CreateCheckoutSession.ProviderUnavailable" },
          { retryAfterSeconds: 5 },
        ),
      },
    });
    render(Decorated(() => <AnonymousCheckoutFlow plan={growth} />));
    await fillIn();
    fireEvent.click(go());
    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toBe(
      "The payment provider can't be reached right now. Try again in 5 seconds.",
    );
  });

  test("a provider that cannot be reached, with no wait to announce, says to try again once", async () => {
    const Decorated = anonymousCheckoutDecorator({
      fail: {
        startCheckout: new KaitenError({
          title: "unavailable",
          status: 503,
          code: "Entitlement.VerificationUnavailable",
        }),
      },
    });
    render(Decorated(() => <AnonymousCheckoutFlow plan={growth} />));
    await fillIn();
    fireEvent.click(go());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The payment provider can't be reached right now. Try again in a moment.",
    );
  });

  test("a button that is not available says why, in a sentence tied to it", async () => {
    mount();
    await passed();
    // Nothing typed: the address is what is missing, and the button says so.
    const hint = () => document.getElementById(go().getAttribute("aria-describedby") ?? "");
    expect(hint()?.textContent).toBe("Enter your email address to continue.");
    // Once the field shows its own error, the sentence is not said twice.
    fireEvent.change(email(), { target: { value: "ada@" } });
    fireEvent.blur(email());
    expect(go().getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(email(), { target: { value: EMAIL } });
    await waitFor(() => expect(off(go())).toBe(false));
    expect(go().getAttribute("aria-describedby")).toBeNull();
  });

  test("a name that is missing is the reason the button gives, once the check passed", async () => {
    mount({ plan: growth, collectName: true });
    await passed();
    fireEvent.change(email(), { target: { value: EMAIL } });
    const hint = document.getElementById(go().getAttribute("aria-describedby") ?? "");
    expect(hint?.textContent).toBe("Enter your name.");
  });

  test("a link to the provider's page says that it opens a tab of its own", async () => {
    mount({ plan: growth }, { visitor: "stays" });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    fireEvent.click(go("Continue to payment"));
    const again = await screen.findByRole("link", { name: "Open the page again" });
    expect(again.getAttribute("target")).toBe("_blank");
    const description = document.getElementById(again.getAttribute("aria-describedby") ?? "");
    expect(description?.textContent).toBe("opens in a new tab");
    // A description, not a part of the name, and nothing to see.
    expect((description as HTMLElement).hidden).toBe(true);
  });

  test("a card that was declined leaves a way out beside the invoice, not a second checkout", async () => {
    const onCancel = vi.fn();
    mount({ plan: growth, onCancel }, { visitor: "saves", payment: "failed" });
    await fillIn();
    fireEvent.click(go());
    await screen.findByText(`For ${EMAIL}`);
    fireEvent.click(go("Continue to payment"));
    await screen.findByText("Your card was declined.", {}, { timeout: 4_000 });
    expect(screen.getByRole("link", { name: "Pay invoice" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start again" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("an address with no place to break is still wrapped by the sentences that print it", async () => {
    mount({ plan: growth }, {});
    await fillIn(LONG_EMAIL);
    fireEvent.click(go());
    const review = await screen.findByText(`For ${LONG_EMAIL}`);
    expect(review.className).toContain("[overflow-wrap:anywhere]");
  });
});
