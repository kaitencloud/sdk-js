// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, fn, userEvent, within } from "storybook/test";
import { de, es, fr } from "@kaitencloud/react/locales";

import { trialPortal } from "../../../.storybook/session-server.ts";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { TrialBanner } from "./trial-banner.tsx";

/**
 * Every story carries its own provider, built once for it, on the real session client and the
 * portal Kaiten recorded for Initech, put in its trial with the block the contract gives
 * (`trialPortal`), which the client maps. The clock is fixed
 * (`now`), so that the countdown and the baselines do not move with the day. The page that adds a
 * card is the provider's: a story never leaves for it, and `navigate` says where it would have gone.
 */
const meta: Meta<typeof TrialBanner> = {
  title: "Flows/TrialBanner",
  component: TrialBanner,
  args: { now: "2026-10-25T05:00:00Z", navigate: action("navigate") },
  decorators: [
    (Story) => (
      <div className="w-full max-w-md">
        <Story />
      </div>
    ),
    portalDecorator({ portal: trialPortal() }),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

const visa = { brand: "visa", last4: "4242" };

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Your trial ends in 5 days", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/will be charged on/)).toBeInTheDocument();
    await expect(canvas.getByText(/No card on file yet/)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Add a card" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  },
};

export const WithACard: Story = {
  name: "With a card on file",
  decorators: [portalDecorator({ portal: trialPortal({ paymentMethod: visa }) })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Card on file: Visa •••• 4242.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Add a card" })).toBeNull();
  },
};

export const NothingToCharge: Story = {
  name: "Nothing is charged at the end",
  decorators: [portalDecorator({ portal: trialPortal({ charge: null }) })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        "Nothing will be charged when your trial ends.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
  },
};

export const Quarterly: Story = {
  name: "Charged every three months",
  decorators: [
    portalDecorator({
      portal: trialPortal({
        charge: { amount: 13500, currency: "EUR", billingPeriod: "QUARTERLY" },
        paymentMethod: visa,
      }),
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/€135\.00 every 3 months/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const LastHours: Story = {
  name: "The last hours",
  args: { now: "2026-10-30T06:30:00Z" },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Your trial ends in 2 hours", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const AskingBeforeCanceling: Story = {
  name: "Asking before ending the trial",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Cancel" }, SLOW));
    await expect(
      canvas.getByText("Your trial will end now, and you won't be charged."),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "End my trial" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Keep my trial" })).toBeInTheDocument();
  },
};

export const SentToTheProvider: Story = {
  name: "Add a card sends the customer to the provider's page",
  args: { navigate: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Add a card" }, SLOW));
    await expect(args.navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//),
    );
  },
};

export const NothingToDo: Story = {
  name: "Nothing to do: the portal offers no action",
  decorators: [
    portalDecorator({
      portal: trialPortal({}, (portal) => {
        portal.capabilities.paymentMethods = false;
        portal.capabilities.unsubscribe = false;
      }),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Your trial ends in 5 days", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("button")).toBeNull();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({ portal: trialPortal() }, fr)],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Votre essai se termine dans 5 jours", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const InSpanish: Story = {
  name: "In Spanish",
  decorators: [portalDecorator({ portal: trialPortal({ paymentMethod: visa }) }, es)],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Su prueba termina en 5 días", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const InGerman: Story = {
  name: "In German",
  decorators: [portalDecorator({ portal: trialPortal({ charge: null }) }, de)],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Ihre Testphase endet in 5 Tagen", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const Unstyled: Story = {
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Your trial ends in 5 days", {}, SLOW),
    ).toBeInTheDocument();
  },
};
