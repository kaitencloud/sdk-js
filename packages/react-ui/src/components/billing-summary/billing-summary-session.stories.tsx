import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { BillingSummary } from "./billing-summary.tsx";

/**
 * The billing summary of a customer session: the subscription as the portal says it, in each state
 * it can be in. Every story carries its own provider, on the real session client and the answers
 * Kaiten recorded for Initech (see `.storybook/portal-mock.tsx`).
 */
const meta: Meta<typeof BillingSummary> = {
  title: "Flows/BillingSummary (session)",
  component: BillingSummary,
  decorators: [portalDecorator()],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

function changed(change: (portal: Record<string, any>) => void): Record<string, any> {
  const portal: Record<string, any> = structuredClone(initechSession.portal);
  change(portal);
  return portal;
}

const trial = changed((portal) => {
  portal.subscription.status = "TRIAL";
  portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
});

const canceled = changed((portal) => {
  portal.subscription.status = "CANCELED";
  portal.upcomingInvoice = null;
  portal.capabilities = { ...portal.capabilities, unsubscribe: false, checkout: true };
});

export const Running: Story = {
  name: "A running subscription",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Active", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^Renews on/)).toBeInTheDocument();
    await expect(canvas.getByText("€49.00/month")).toBeInTheDocument();
    await expect(canvas.getByText(/^Visa •••• 4242 · 12\/2030$/)).toBeInTheDocument();
  },
};

export const InATrial: Story = {
  name: "In a trial",
  decorators: [portalDecorator({ portal: trial })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Trial", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^Trial ends on/)).toBeInTheDocument();
  },
};

export const CancellationScheduled: Story = {
  name: "A cancellation is scheduled",
  decorators: [portalDecorator({ portal: "portalCanceling" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^Ends on/, {}, SLOW)).toBeInTheDocument();
    await expect(canvas.queryByText(/^Renews on/)).toBeNull();
  },
};

export const PastDueQuarterly: Story = {
  name: "Payment failed, billed quarterly",
  decorators: [portalDecorator({ portal: "portalPastDue" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findAllByText("Payment failed", {}, SLOW)).length).toBeGreaterThan(
      0,
    );
    await expect(canvas.getByText("€135.00 every 3 months")).toBeInTheDocument();
    await expect(canvas.getByText("Your latest payment didn't go through.")).toBeInTheDocument();
  },
};

export const Over: Story = {
  name: "The subscription is over",
  decorators: [portalDecorator({ portal: canceled })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Canceled", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Your subscription has ended.")).toBeInTheDocument();
  },
};

export const ScheduledChange: Story = {
  name: "A plan change is scheduled",
  decorators: [portalDecorator({ portal: "portalScheduledChange" })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/^Changes to €490\.00\/year on/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const Unbound: Story = {
  name: "A session bound to the customer only",
  decorators: [portalDecorator({ portal: "portalCustomerWide" })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("There's no subscription to show.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const HostMoney: Story = {
  name: "What the host says of the money wins",
  args: {
    billing: {
      amount: 10_000,
      currencyCode: "EUR",
      interval: "month",
      paymentMethodLabel: "Invoiced to Initech",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Invoiced to Initech", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.queryByText(/Visa/)).toBeNull();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({ portal: "portalCanceling" }, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Actif", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^Se termine le/)).toBeInTheDocument();
  },
};
