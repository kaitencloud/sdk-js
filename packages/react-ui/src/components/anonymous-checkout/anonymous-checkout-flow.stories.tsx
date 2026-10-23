// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { KaitenError, RateLimitedError, TurnstileFailedError } from "@kaitencloud/client";
import { fr } from "@kaitencloud/react/locales";

import {
  anonymousCheckoutDecorator,
  enterprise,
  growth,
  latestAnonymousClient,
  lite,
  pro,
  starter,
} from "../../../.storybook/anonymous-checkout-mock.tsx";
import { AnonymousCheckoutFlow } from "./anonymous-checkout-flow.tsx";

const EMAIL = "ada@example.com";
/** An address that is valid and has no space to break at: the longest word a checkout prints. */
const LONG_EMAIL = "ada.lovelace.with.a.very.long.address@subdomain.example-company.test";

// Module constants, not built inside a decorator or a render: a new client is a new checkout.
const standard = anonymousCheckoutDecorator();
const SLOW = { timeout: 5_000 };

/**
 * Every story carries its own provider, built once for it: a story is a visitor in one situation,
 * and the situation is the double's script (see `.storybook/anonymous-checkout-mock.tsx`). The
 * security check is a stand-in for Cloudflare's script that plays the behaviour of its test keys, so
 * no story reaches the network. `meta` carries no provider, because a nested provider with the same
 * scope is a no-op: a story that is not scripted names `standard`.
 */
const meta: Meta<typeof AnonymousCheckoutFlow> = {
  title: "Flows/AnonymousCheckoutFlow",
  component: AnonymousCheckoutFlow,
  args: {
    plan: growth,
    successUrl: "https://shop.example.test/welcome",
    onStarted: fn(),
    onSubscribed: fn(),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

/** Waits for the security check to pass: the button that starts the checkout answers to it. */
async function checked(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await expect(await canvas.findByText("Security check passed.", {}, SLOW)).toBeInTheDocument();
  return canvas;
}

async function typeEmail(canvas: ReturnType<typeof within>, email = EMAIL) {
  await userEvent.type(await canvas.findByLabelText("Email"), email);
}

/**
 * The button that starts the checkout waits on the form and on the security check without leaving
 * the keyboard: it is dimmed with `aria-disabled`, and `disabled` is for what is in flight.
 */
const unavailable = (button: HTMLElement) =>
  expect(button).toHaveAttribute("aria-disabled", "true");
const available = (button: HTMLElement) =>
  waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"), SLOW);

/** Fills the form in and presses the button that starts the checkout. */
async function start(
  canvasElement: HTMLElement,
  button: string | RegExp = "Continue",
  email = EMAIL,
) {
  const canvas = await checked(canvasElement);
  await typeEmail(canvas, email);
  const go = canvas.getByRole("button", { name: button });
  await available(go);
  await userEvent.click(go);
  return canvas;
}

/** The review of what is due, once the checkout is started. */
async function reviewed(canvasElement: HTMLElement, email = EMAIL) {
  const canvas = await start(canvasElement, "Continue", email);
  await expect(await canvas.findByText(`For ${email}`, {}, SLOW)).toBeInTheDocument();
  return canvas;
}

export const Default: Story = {
  decorators: [standard],
  play: async ({ canvasElement }) => {
    const canvas = await checked(canvasElement);
    // The billing periods are one radio group, named by its legend, the monthly fee taken.
    await expect(canvas.getByRole("radiogroup", { name: "Billing interval" })).toBeInTheDocument();
    await expect(canvas.getByRole("radio", { name: "$79.00/month" })).toBeChecked();
    // The form, and the security check that guards the button.
    await expect(canvas.getByRole("group", { name: "Security check" })).toBeInTheDocument();
    await expect(canvas.queryByLabelText("Name")).toBeNull();
    const go = canvas.getByRole("button", { name: "Continue" });
    await unavailable(go);
    await typeEmail(canvas);
    await available(go);
  },
};

export const WaitingForTheSecurityCheck: Story = {
  name: "The security check has not passed yet",
  decorators: [anonymousCheckoutDecorator({ widget: "never" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await typeEmail(canvas);
    await expect(await canvas.findByText("Running the security check…")).toBeInTheDocument();
    await unavailable(canvas.getByRole("button", { name: "Continue" }));
    await expect(
      canvas.getByText("The button is available once the security check passes."),
    ).toBeInTheDocument();
  },
};

export const InteractiveSecurityCheck: Story = {
  name: "A security check that asks the visitor",
  decorators: [anonymousCheckoutDecorator({ widget: "interactive" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await typeEmail(canvas);
    const go = canvas.getByRole("button", { name: "Continue" });
    await unavailable(go);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Verify you are human" }, SLOW),
    );
    await expect(await canvas.findByText("Security check passed.", {}, SLOW)).toBeInTheDocument();
    await available(go);
  },
};

export const SecurityCheckFailed: Story = {
  name: "A security check that failed",
  decorators: [anonymousCheckoutDecorator({ widget: "blocks" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The script loaded and the widget reported an error: not the advice for a script that is blocked.
    await expect(
      await canvas.findByText("The security check failed. Try it again.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.queryByText(/challenges\.cloudflare\.com/)).toBeNull();
    await expect(canvas.getByRole("button", { name: "Try the check again" })).toBeEnabled();
    await unavailable(canvas.getByRole("button", { name: "Continue" }));
  },
};

export const SecurityCheckBlocked: Story = {
  name: "A security check that cannot run",
  decorators: [anonymousCheckoutDecorator({ widget: "unloadable" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/The security check could not load/, {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Try the check again" })).toBeEnabled();
    await unavailable(canvas.getByRole("button", { name: "Continue" }));
  },
};

export const Review: Story = {
  decorators: [standard],
  name: "What is due, before the visitor confirms",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    // The server's line, and the server's total.
    await expect(canvas.getAllByText("$79.00").length).toBeGreaterThan(0);
    await expect(canvas.getByText("Due today")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
    await expect(canvas.getByRole("button", { name: "Change my choices" })).toBeEnabled();
  },
};

export const ReviewOfALongAddress: Story = {
  decorators: [standard],
  name: "Reviewing an order for a very long address",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement, LONG_EMAIL);
    // The address wraps inside the card: the page does not scroll sideways (see tests/layout).
    await expect(canvas.getByText(`For ${LONG_EMAIL}`)).toBeInTheDocument();
  },
};

export const ChangingTheChoices: Story = {
  decorators: [standard],
  name: "Going back to change the choices",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Change my choices" }));
    // The form is back with what was typed, and a security check to pass again.
    await expect(await canvas.findByLabelText("Email")).toHaveValue(EMAIL);
    await expect(await canvas.findByText("Security check passed.", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled();
  },
};

export const SavingAPaymentMethod: Story = {
  decorators: [standard],
  name: "Saving a payment method",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText(/Save your payment method in the window we opened/, {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Open the page again" })).toHaveAttribute(
      "href",
      "https://pay.example.test/setup/chk_mock_1",
    );
    await expect(
      canvas.getByRole("button", { name: "I've saved my payment method" }),
    ).toBeEnabled();
  },
};

export const PaymentMethodNotSavedYet: Story = {
  decorators: [standard],
  name: "Back before a payment method was saved",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await userEvent.click(
      await canvas.findByRole("button", { name: "I've saved my payment method" }, SLOW),
    );
    await expect(
      await canvas.findByText(/We haven't received a payment method yet/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const Bought: Story = {
  name: "Bought, from the first payment method to the receipt",
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "paid" })],
  play: async ({ canvasElement, args }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Payment received.")).toBeInTheDocument();
    // The host's page for after the checkout, and no sentence about the order that one replaces.
    await expect(canvas.getByRole("link", { name: "Continue" })).toHaveAttribute(
      "href",
      "https://shop.example.test/welcome",
    );
    await expect(canvas.queryByText(/registered for ada@example.com/)).toBeNull();
    await waitFor(() => expect(args.onSubscribed).toHaveBeenCalledTimes(1), SLOW);
  },
};

export const BoughtForALongAddress: Story = {
  name: "Bought, with the order registered for a very long address",
  args: { successUrl: undefined },
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "paid" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement, LONG_EMAIL);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(
      canvas.getByText(`Your order is registered for ${LONG_EMAIL}.`),
    ).toBeInTheDocument();
  },
};

export const BoughtWithNothingToContinueTo: Story = {
  name: "Bought, with the order registered and nowhere to go on to",
  args: { successUrl: undefined },
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "paid" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(
      canvas.getByText("Your order is registered for ada@example.com."),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Continue" })).toBeNull();
  },
};

export const FreePlan: Story = {
  decorators: [standard],
  name: "A free plan, started with one button",
  args: { plan: starter },
  play: async ({ canvasElement, args }) => {
    const canvas = await start(canvasElement, "Start for free");
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Nothing is due today.")).toBeInTheDocument();
    await expect(args.onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, name: null }),
    );
    await waitFor(() => expect(args.onSubscribed).toHaveBeenCalledTimes(1), SLOW);
    // No payment method was asked for, and no provider's page opened.
    await expect(canvas.queryByText(/Save your payment method/)).toBeNull();
  },
};

export const FreeTrial: Story = {
  decorators: [standard],
  name: "A free trial that asks for no payment method",
  args: { plan: lite },
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await expect(await canvas.findByText("$0.00 today", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^Trial ends on /)).toBeInTheDocument();
    await expect(
      canvas.getByText("No payment method is asked for. Nothing is charged unless you add one."),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Start free trial" }));
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getAllByText(/^Trial ends on /).length).toBeGreaterThan(0);
  },
};

export const TrialAlreadyUsed: Story = {
  name: "A trial this email already had",
  args: { plan: lite },
  decorators: [anonymousCheckoutDecorator({ usedTrialEmail: EMAIL })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await expect(
      await canvas.findByText(
        "This email has already had this plan's trial, so the first period is due today.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(canvas.getAllByText("$19.00").length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  },
};

export const TrialThatAsksForACard: Story = {
  decorators: [standard],
  name: "A trial that asks for a payment method first",
  args: { plan: pro },
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await expect(await canvas.findByText("$0.00 today", {}, SLOW)).toBeInTheDocument();
    // What the card is for: the catalogue's price, from the day the trial ends.
    await expect(
      canvas.getByText(/^Then \$49\.00\/month from .+, unless you cancel before\.$/),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  },
};

export const AmountChanged: Story = {
  decorators: [standard],
  name: "The amount changed since it was shown",
  args: { plan: pro },
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    // Another checkout for the same email takes the trial first.
    latestAnonymousClient().consumeTrial("chk_mock_1");
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));

    await expect(
      await canvas.findByText(
        "The amount due changed from $0.00 to $49.00. Check it before you continue.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/has already had this plan's trial/)).toBeInTheDocument();
    // Nothing was opened: the visitor goes on when they have seen it.
    await expect(canvas.queryByText(/Save your payment method/)).toBeNull();
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText(/Save your payment method in the window we opened/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const WaitingForThePayment: Story = {
  name: "A payment not known yet",
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "processing" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText("Your plan starts once your payment is confirmed.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Waiting for your payment...")).toBeInTheDocument();
    await expect(canvas.queryByText("You're subscribed")).toBeNull();
  },
};

export const PaymentToConfirm: Story = {
  name: "A payment to confirm",
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "requires_action" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText("Confirm your payment to finish.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Complete payment" })).toHaveAttribute(
      "href",
      "https://pay.example.test/invoice/chk_mock_1",
    );
  },
};

export const CardDeclined: Story = {
  name: "A card that was declined",
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "failed" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(await canvas.findByText("Your card was declined.", {}, SLOW)).toBeInTheDocument();
    // Still read on a schedule, but not said: "waiting" under "declined" would contradict it.
    await expect(canvas.queryByText("Waiting for your payment...")).toBeNull();
    await expect(canvas.getByRole("link", { name: "Pay invoice" })).toBeInTheDocument();
  },
};

export const PaymentNeverCame: Story = {
  name: "A payment that never came",
  decorators: [anonymousCheckoutDecorator({ visitor: "saves", payment: "expired" })],
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText(
        "The payment didn't come through in time, so this checkout was closed.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Start again" }));
    await expect(await canvas.findByLabelText("Email")).toHaveValue(EMAIL);
  },
};

export const LeftOpenTooLong: Story = {
  decorators: [standard],
  name: "A checkout left open too long",
  play: async ({ canvasElement }) => {
    const canvas = await reviewed(canvasElement);
    latestAnonymousClient().abandon("chk_mock_1");
    await userEvent.click(canvas.getByRole("button", { name: "Continue to payment" }));
    await expect(
      await canvas.findByText(
        "This checkout stayed open for too long and was closed. Nothing was charged.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Start again" })).toBeEnabled();
  },
};

export const BackWithoutTheSession: Story = {
  name: "Back without the session's token",
  decorators: [anonymousCheckoutDecorator({ returnedTo: "chk_unknown" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("We can't find this checkout in this browser.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/If you already paid, please don't pay again/),
    ).toBeInTheDocument();
    // The visitor decides to start again: the flow never does it for them.
    await expect(canvas.getByRole("button", { name: "Start a new checkout" })).toBeEnabled();
    await expect(
      latestAnonymousClient().calls.some((call) => call.method === "startCheckout"),
    ).toBe(false);
  },
};

export const TurnstileRefused: Story = {
  name: "The security check was refused",
  decorators: [
    anonymousCheckoutDecorator({
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
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await start(canvasElement);
    await expect(
      await canvas.findByText(
        "We couldn't verify the security check. Please complete it again.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    // The form is back with what was typed, and a new token to try again with.
    await expect(canvas.getByLabelText("Email")).toHaveValue(EMAIL);
    await waitFor(
      () => expect(canvas.getByRole("button", { name: "Continue" })).toBeEnabled(),
      SLOW,
    );
    // The new check passed, and the refusal is not contradicted by saying so beside it.
    await expect(canvas.queryByText("Security check passed.")).toBeNull();
  },
};

export const RateLimited: Story = {
  name: "Too many attempts",
  decorators: [
    anonymousCheckoutDecorator({
      fail: {
        startCheckout: new RateLimitedError(
          { title: "rate limited", status: 429, code: "CreateCheckoutSession.RateLimited" },
          { retryAfterSeconds: 45 },
        ),
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await start(canvasElement);
    await expect(
      await canvas.findByText("Too many attempts. Try again in 45 seconds.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const PlanNotForSale: Story = {
  decorators: [standard],
  name: "A plan that is not sold online",
  args: { plan: enterprise },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("This plan isn't sold online. Contact us to get it.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "https://example.test/contact",
    );
    await expect(canvas.queryByLabelText("Email")).toBeNull();
  },
};

export const PlanRefusedByTheServer: Story = {
  name: "A plan the server will not sell",
  decorators: [
    anonymousCheckoutDecorator({
      fail: {
        startCheckout: new KaitenError({
          title: "not public",
          status: 422,
          code: "CreateCheckoutSession.PriceNotPublic",
        }),
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await start(canvasElement);
    await expect(
      await canvas.findByText("This plan can't be bought right now.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const QuotaReached: Story = {
  name: "The vendor cannot take another customer",
  args: { plan: starter },
  decorators: [
    anonymousCheckoutDecorator({
      fail: {
        confirmCheckout: new KaitenError({
          title: "quota",
          status: 409,
          code: "ConfirmCheckoutSession.EntitlementLimitReached",
        }),
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = await start(canvasElement, "Start for free");
    await expect(
      await canvas.findByText("We can't take new sign-ups right now. Please contact us.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const NotOffered: Story = {
  name: "The key cannot start an anonymous checkout",
  decorators: [anonymousCheckoutDecorator({ off: true })],
  play: async ({ canvasElement }) => {
    // The catalogue does not say it may: nothing is drawn.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(canvasElement.querySelector('[data-slot="anonymous-checkout-flow"]')).toBeNull();
  },
};

export const WithAName: Story = {
  decorators: [standard],
  name: "Asking for a name too",
  args: { collectName: true, plan: starter, onStarted: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = await checked(canvasElement);
    await typeEmail(canvas);
    const go = canvas.getByRole("button", { name: "Start for free" });
    // The name is asked for, so the button waits for it.
    await unavailable(go);
    await userEvent.type(canvas.getByLabelText("Name"), "Ada Lovelace");
    await available(go);
    await userEvent.click(go);
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    // Kaiten has no member for a name: the page gets it, and nothing else does.
    await expect(args.onStarted).toHaveBeenCalledWith({
      sessionId: "chk_mock_1",
      email: EMAIL,
      name: "Ada Lovelace",
    });
  },
};

export const Unstyled: Story = {
  decorators: [standard],
  parameters: {
    docs: {
      description: {
        story: "Headless markup — bring your own styles. All styling is removed (`unstyled`).",
      },
    },
  },
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const canvas = await checked(canvasElement);
    // The browser's own radios: the unstyled markup carries no radio group of the SDK's.
    const monthly = canvas.getByRole("radio", { name: "$79.00/month" });
    await expect(monthly.tagName).toBe("INPUT");
    await expect(monthly).toBeChecked();
    await expect(canvas.getByLabelText("Email").tagName).toBe("INPUT");
  },
};

export const French: Story = {
  decorators: [anonymousCheckoutDecorator({}, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Contrôle de sécurité réussi.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByLabelText("E-mail")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Continuer" })).toBeInTheDocument();
  },
};

export const Dark: Story = {
  decorators: [standard],
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    await checked(canvasElement);
  },
};

export const DarkReview: Story = {
  decorators: [standard],
  name: "Dark, reviewing what is due",
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    await reviewed(canvasElement);
  },
};
