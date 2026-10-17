// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import {
  checkoutDecorator,
  extraSeats,
  growthPlan,
  STORY_CODE,
} from "../../../.storybook/checkout-mock.tsx";
import { CheckoutFlow } from "./checkout-flow.tsx";

// Module constants, not built inside a decorator or a render: a new plan object is a new flow.
const plan = growthPlan();
const planWithTrial = growthPlan({ trialPeriodDays: 14 });

/**
 * Every story carries its own provider, built once for it: a story is a customer in one
 * situation, and the situation is the double's script (see `.storybook/checkout-mock.tsx`).
 * `meta` carries none, because a nested provider with the same scope is a no-op.
 */
const meta: Meta<typeof CheckoutFlow> = {
  title: "Flows/CheckoutFlow",
  component: CheckoutFlow,
  args: {
    plan,
    addOns: [extraSeats],
    portalHref: "https://app.example.test/billing",
    onSubscribed: action("onSubscribed"),
    onCancel: action("onCancel"),
  },
  decorators: [checkoutDecorator()],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

/** Waits for what is due to be on screen, and for the checkout to be allowed. */
async function priced(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const subscribe = await canvas.findByRole("button", { name: /^Subscribe/ }, SLOW);
  await waitFor(() => expect(subscribe).toBeEnabled(), SLOW);
  return { canvas, subscribe };
}

/** Subscribes: the customer has chosen, and pressed the button. */
async function subscribe(canvasElement: HTMLElement) {
  const { canvas, subscribe: button } = await priced(canvasElement);
  await userEvent.click(button);
  return canvas;
}

async function applyCode(canvas: ReturnType<typeof within>, code: string) {
  await userEvent.type(await canvas.findByLabelText("Voucher code"), code);
  await userEvent.click(await canvas.findByRole("button", { name: "Apply" }));
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    // The billing periods are one radio group, named by its legend, the monthly fee taken.
    await expect(canvas.getByRole("radiogroup", { name: "Billing interval" })).toBeInTheDocument();
    await expect(canvas.getByRole("radio", { name: "$79.00/month" })).toBeChecked();
    await expect(canvas.getByRole("radio", { name: "$790.00/year" })).not.toBeChecked();
    // The server's line, and the server's total.
    await expect(canvas.getAllByText("$79.00").length).toBeGreaterThan(0);
    await expect(canvas.getByText("Due today")).toBeInTheDocument();
  },
};

export const AnnualPeriod: Story = {
  name: "The annual period, chosen with the keyboard",
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    const monthly = canvas.getByRole("radio", { name: "$79.00/month" });
    const annual = canvas.getByRole("radio", { name: "$790.00/year" });
    // The keyboard is on the chosen period, and the arrow takes the next one.
    monthly.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(annual).toHaveFocus();
    await expect(annual).toBeChecked();
    await expect(monthly).not.toBeChecked();
    // Another period is another price, priced again by the server.
    await expect((await canvas.findAllByText("$790.00", {}, SLOW)).length).toBeGreaterThan(0);
  },
};

export const AddOnNotSoldForThePeriod: Story = {
  name: "An add-on the billing period does not sell",
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    const more = canvas.getByRole("button", { name: "Add one Extra seats" });
    await userEvent.click(more);
    await userEvent.click(more);
    // $79.00 + 2 × $25.00: the server's sum.
    await expect(await canvas.findByText("$129.00", {}, SLOW)).toBeInTheDocument();

    // The seats have a fee by the month only: Kaiten attaches none by the year, so the year does
    // not offer them, and they leave what is bought and priced.
    await userEvent.click(canvas.getByRole("radio", { name: "$790.00/year" }));
    await expect(
      canvasElement.querySelector('[data-slot="checkout-flow-addons"]'),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(canvas.queryByText("$129.00")).toBeNull(), SLOW);
    await expect((await canvas.findAllByText("$790.00", {}, SLOW)).length).toBeGreaterThan(0);

    // Back by the month they are offered again, at none: no quantity was kept for them.
    await userEvent.click(canvas.getByRole("radio", { name: "$79.00/month" }));
    await expect(canvas.getByRole("status", { name: "Quantity of Extra seats" })).toHaveTextContent(
      "0",
    );
    // And the month alone is priced again.
    await priced(canvasElement);
  },
};

export const AddOnsAndVoucher: Story = {
  name: "Add-ons and a voucher",
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    const more = canvas.getByRole("button", { name: "Add one Extra seats" });
    await userEvent.click(more);
    await userEvent.click(more);
    await applyCode(canvas, STORY_CODE);

    // The code was typed once and has left the page.
    await expect(await canvas.findByText("Voucher applied", {}, SLOW)).toBeInTheDocument();
    await expect(canvasElement.innerHTML).not.toContain(STORY_CODE);
    // The field is gone, and the keyboard is on the sentence that took its place.
    await waitFor(() =>
      expect(canvasElement.ownerDocument.activeElement).toBe(canvas.getByText("Voucher applied")),
    );
    // $79.00 + 2 × $25.00 - 20% of the base fee: the server's sum.
    await expect(await canvas.findByText("$113.20", {}, SLOW)).toBeInTheDocument();
  },
};

export const VoucherRefused: Story = {
  name: "A voucher that cannot be used",
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    await applyCode(canvas, "NOPE");

    await expect(await canvas.findByText("This code can't be used.", {}, SLOW)).toBeInTheDocument();
    // The summary it had is still there, and the checkout waits for the customer to say what to do.
    await expect(canvas.getAllByText("$79.00").length).toBeGreaterThan(0);
    await expect(canvas.getByRole("button", { name: /^Subscribe/ })).toBeDisabled();
  },
};

export const FreeTrial: Story = {
  name: "A free trial",
  args: { plan: planWithTrial },
  decorators: [checkoutDecorator({ trial: true, outcome: "trial" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("$0.00 today", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Trial ends on Nov 2, 2026")).toBeInTheDocument();
    // The plan is subscribed with its trial: there is nothing to tick to start without it.
    await expect(canvas.queryByRole("checkbox")).toBeNull();
  },
};

export const BillingEmailNeeded: Story = {
  name: "A customer with no billing email",
  decorators: [checkoutDecorator({ noEmail: true })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByLabelText("Billing email", {}, SLOW)).toBeInTheDocument();
    // What is due is shown without an address; the address is only needed to subscribe.
    await expect((await canvas.findAllByText("$79.00", {}, SLOW)).length).toBeGreaterThan(0);
    await expect(canvas.getByText("Enter your billing email to subscribe.")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Subscribe/ })).toBeDisabled();
  },
};

export const Processing: Story = {
  name: "Making the checkout",
  decorators: [checkoutDecorator({ outcome: "never" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(await canvas.findByRole("button", { name: /^Processing/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const SavingAPaymentMethod: Story = {
  name: "Saving a payment method",
  decorators: [checkoutDecorator({ outcome: "needs_payment_method" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText(/Save your payment method in the window we opened/, {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Open the page again" })).toHaveAttribute(
      "href",
      "https://pay.example.test/setup/cs_story",
    );
  },
};

export const Subscribed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Payment received.")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "View receipt" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  },
};

export const SubscribedWithATrial: Story = {
  name: "Subscribed, with a trial",
  args: { plan: planWithTrial },
  decorators: [checkoutDecorator({ trial: true, outcome: "trial" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(await canvas.findByText("You're subscribed", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Trial ends on Nov 2, 2026")).toBeInTheDocument();
  },
};

export const PaymentToConfirm: Story = {
  name: "A payment to confirm",
  decorators: [checkoutDecorator({ outcome: "requires_action" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText("Confirm your payment to finish.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Complete payment" })).toHaveAttribute(
      "href",
      "https://pay.example.test/i/inv_story_activation",
    );
    await expect(canvas.getByText("Waiting for your payment...")).toBeInTheDocument();
  },
};

export const PaymentProcessing: Story = {
  name: "A payment not known yet",
  decorators: [checkoutDecorator({ outcome: "processing" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText("Waiting for your payment...", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Complete payment" })).toBeNull();
  },
};

export const CardDeclined: Story = {
  name: "A card that was declined",
  decorators: [checkoutDecorator({ outcome: "failed" })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText("You're subscribed, but your card was declined.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Update payment method" })).toBeEnabled();
    await expect(canvas.getByRole("link", { name: "Pay invoice" })).toBeInTheDocument();
  },
};

export const PaymentToConfirmBeforeThePlanStarts: Story = {
  name: "A payment to confirm, before the plan starts",
  decorators: [checkoutDecorator({ outcome: "requires_action", incomplete: true })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText("Your plan starts once your payment is confirmed.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.queryByText("You're subscribed")).toBeNull();
    await expect(canvas.getByText("Confirm your payment to finish.")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Complete payment" })).toBeInTheDocument();
  },
};

export const CardDeclinedBeforeThePlanStarts: Story = {
  name: "A card that was declined, before the plan starts",
  decorators: [checkoutDecorator({ outcome: "failed", incomplete: true })],
  play: async ({ canvasElement }) => {
    const canvas = await subscribe(canvasElement);
    await expect(
      await canvas.findByText("Your plan starts once your payment is confirmed.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByText("Your card was declined.")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Update payment method" })).toBeEnabled();
    await expect(canvas.getByRole("link", { name: "Pay invoice" })).toBeInTheDocument();
  },
};

export const AlreadySubscribed: Story = {
  name: "Already subscribed",
  decorators: [checkoutDecorator({ previewRefusal: "already_subscribed" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("You already have a subscription.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Manage your subscription" })).toHaveAttribute(
      "href",
      "https://app.example.test/billing",
    );
  },
};

export const OverQuota: Story = {
  name: "Over the plan's quota",
  decorators: [checkoutDecorator({ previewRefusal: "quota_exceeded" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The entitlements it names are the slugs here: the portal of this story has none to name them.
    await expect(await canvas.findByText(/seats, api-calls/, {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Subscribe/ })).toBeDisabled();
  },
};

export const ProviderDown: Story = {
  name: "The payment provider is down",
  decorators: [checkoutDecorator({ previewRefusal: "unavailable" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/The payment provider can't be reached right now/, {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeEnabled();
  },
};

export const Unstyled: Story = {
  parameters: {
    docs: {
      description: {
        story: "Headless markup — bring your own styles. All styling is removed (`unstyled`).",
      },
    },
  },
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const { canvas } = await priced(canvasElement);
    // The browser's own radios: the unstyled markup carries no radio group of the SDK's.
    const monthly = canvas.getByRole("radio", { name: "$79.00/month" });
    await expect(monthly.tagName).toBe("INPUT");
    await expect(monthly).toBeChecked();
  },
};

export const French: Story = {
  decorators: [checkoutDecorator({}, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("À payer aujourd'hui", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Souscrire/ })).toBeInTheDocument();
  },
};

export const Dark: Story = {
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    await priced(canvasElement);
  },
};
