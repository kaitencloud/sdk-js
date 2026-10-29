// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { checkoutDecorator, STORY_CODE } from "../../../.storybook/checkout-mock.tsx";
import { CheckoutSummary, type CheckoutSummarySelection } from "./checkout-summary.tsx";

const monthly: CheckoutSummarySelection = { licensePriceId: "price_growth_monthly" };
const withSeats: CheckoutSummarySelection = {
  licensePriceId: "price_growth_monthly",
  addOns: { "extra-seats-v1": 2 },
};

const SLOW = { timeout: 5_000 };

/** Every story carries its own provider and its own script of what the server says is due. */
const meta: Meta<typeof CheckoutSummary> = {
  title: "Flows/CheckoutSummary",
  component: CheckoutSummary,
  args: { selection: withSeats },
  decorators: [checkoutDecorator()],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const PlanAndAddOns: Story = {
  name: "A plan and add-ons",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Extra seats", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("2 × 25.00 USD")).toBeInTheDocument();
    await expect(canvas.getByText("$129.00")).toBeInTheDocument();
  },
};

export const WithAVoucher: Story = {
  name: "With a voucher",
  args: { selection: { ...withSeats, voucherCode: STORY_CODE } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Welcome 20%", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("-$15.80")).toBeInTheDocument();
    await expect(canvas.getByText("$113.20")).toBeInTheDocument();
    // The code is the checkout's, not the page's.
    await expect(canvasElement.innerHTML).not.toContain(STORY_CODE);
  },
};

export const TotalOfTheServer: Story = {
  name: "A total that is not the sum of its lines",
  decorators: [checkoutDecorator({ totalOverride: 9999 })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Extra seats", {}, SLOW)).toBeInTheDocument();
    // The lines add up to $129.00; what is due is what the server says.
    await expect(canvas.getByText("$99.99")).toBeInTheDocument();
    await expect(canvas.queryByText("$129.00")).toBeNull();
  },
};

export const FreeTrial: Story = {
  name: "A free trial",
  args: { selection: monthly },
  decorators: [checkoutDecorator({ trial: true })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("$0.00 today", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Trial ends on Nov 2, 2026")).toBeInTheDocument();
  },
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story: "The server is slow to answer: a placeholder stands where the lines will be.",
      },
    },
  },
  decorators: [checkoutDecorator({ delayMs: 600_000 })],
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(canvasElement.querySelector('[data-slot="checkout-summary-loading"]')).not.toBeNull(),
    );
  },
};

export const NothingChosen: Story = {
  name: "Nothing chosen yet",
  args: { selection: { licensePriceId: null } },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Choose a plan to see what is due today."),
    ).toBeInTheDocument();
  },
};

export const OverQuota: Story = {
  name: "Over the plan's quota",
  decorators: [checkoutDecorator({ previewRefusal: "quota_exceeded" })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/seats, api-calls/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const ProviderDown: Story = {
  name: "The payment provider is down",
  decorators: [checkoutDecorator({ previewRefusal: "unavailable" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/can't be reached right now/, {}, SLOW),
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
    await expect(
      await within(canvasElement).findByText(/Extra seats/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const French: Story = {
  decorators: [checkoutDecorator({}, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("À payer aujourd'hui", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^129,00/)).toBeInTheDocument();
  },
};

export const Dark: Story = {
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Extra seats", {}, SLOW),
    ).toBeInTheDocument();
  },
};
