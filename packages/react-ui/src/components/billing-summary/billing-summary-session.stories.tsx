import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { BillingSummary } from "./billing-summary.tsx";

/**
 * The recorded portals hold no quota near its limit: AI credits unused, API calls at 15% of a soft
 * limit and the seats used up. Every summary here adds one, Projects at 42 of a hard 50 (84%), so it
 * shows the four readings a meter gives at once: healthy, an allowance not reached, near the limit
 * and on it. It is shaped as the portal shapes an entitlement, its provenance a licence grant alone.
 */
function withProjectsNearLimit(recorded: Record<string, any>): Record<string, any> {
  const portal: Record<string, any> = structuredClone(recorded);
  portal.entitlements.push({
    slug: "projects",
    name: "Projects",
    type: "NUMBER",
    limitValue: { type: "number", value: 50 },
    currentValue: 42,
    unlimited: false,
    limitCapExceededOveragePercent: 0,
    maximumAllowedUsage: 50,
    percentageUsed: 84,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    source: "license",
    provenance: {
      license: {
        licenseEntitlementId: "00000000-0000-4000-8000-000000000e09",
        value: { type: "number", value: 50 },
        limitCapExceededOveragePercent: 0,
      },
      addons: [],
      boosts: [],
      number: {
        license: 50,
        afterAddons: 50,
        boostSet: null,
        boostAdd: null,
        boostMultiply: null,
        unlimited: false,
        effective: 50,
      },
    },
  });
  return portal;
}

const running = withProjectsNearLimit(initechSession.portal);
const canceling = withProjectsNearLimit(initechSession.portalCanceling);
const pastDue = withProjectsNearLimit(initechSession.portalPastDue);
const scheduledChange = withProjectsNearLimit(initechSession.portalScheduledChange);

/**
 * The billing summary of a customer session: the subscription as the portal says it, in each state
 * it can be in. Every story carries its own provider, on the real session client and the answers
 * Kaiten recorded for Initech (see `.storybook/portal-mock.tsx`).
 */
const meta: Meta<typeof BillingSummary> = {
  title: "Flows/BillingSummary (session)",
  component: BillingSummary,
  decorators: [portalDecorator({ portal: running })],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

function changed(change: (portal: Record<string, any>) => void): Record<string, any> {
  const portal: Record<string, any> = structuredClone(running);
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
    // The four readings of a meter, side by side.
    const state = (name: string) =>
      canvas.getByRole("progressbar", { name: new RegExp(`^${name}:`) }).dataset.usageState;
    await expect(state("AI credits")).toBe("healthy");
    await expect(state("API calls")).toBe("healthy");
    await expect(state("Projects")).toBe("near_limit");
    await expect(state("Seats")).toBe("at_limit");
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
  decorators: [portalDecorator({ portal: canceling })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^Ends on/, {}, SLOW)).toBeInTheDocument();
    await expect(canvas.queryByText(/^Renews on/)).toBeNull();
  },
};

export const PastDueQuarterly: Story = {
  name: "Payment failed, billed quarterly",
  decorators: [portalDecorator({ portal: pastDue })],
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
  decorators: [portalDecorator({ portal: scheduledChange })],
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
  decorators: [portalDecorator({ portal: canceling }, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Actif", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/^Se termine le/)).toBeInTheDocument();
  },
};
