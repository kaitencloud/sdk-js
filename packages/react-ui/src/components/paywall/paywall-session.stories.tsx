import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { Paywall } from "./paywall.tsx";

/**
 * The wall of a customer session, whose subscription is the portal's: where it stands explains a
 * wall and changes what is offered, and closes none. The limit is the one the recorded instance
 * is at (eight seats of eight). Every story carries its own provider, on the real session client
 * and what Kaiten answered for Initech (see `.storybook/portal-mock.tsx`).
 */
const gated = (
  <div className="flex min-h-80 w-full max-w-[32rem] flex-col gap-3 rounded-lg border border-border p-4">
    <p className="text-sm font-medium">Seats in use</p>
    <div className="flex flex-1 items-end gap-2" aria-hidden="true">
      {[38, 62, 45, 80, 54, 71, 49, 66].map((height, index) => (
        <div
          className="flex-1 rounded-t-sm bg-primary/70"
          key={index}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  </div>
);

const meta: Meta<typeof Paywall> = {
  title: "Flows/Paywall (session)",
  component: Paywall,
  args: {
    entitlement: "seats",
    mode: "soft",
    onUpgrade: action("onUpgrade"),
    onDismiss: action("onDismiss"),
    children: gated,
  },
  decorators: [
    (Story) => (
      <div className="relative min-h-[280px] w-full max-w-xl rounded-lg border border-dashed border-border p-4">
        <Story />
      </div>
    ),
    portalDecorator(),
  ],
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
  name: "A running subscription: an upgrade",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: /^Upgrade/ }, SLOW)).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-slot="paywall-subscription-note"]')).toBeNull();
  },
};

export const TrialEnding: Story = {
  name: "In a trial",
  decorators: [portalDecorator({ portal: trial })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/^Trial ends on/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const CancellationScheduled: Story = {
  name: "A cancellation is scheduled",
  decorators: [portalDecorator({ portal: "portalCanceling" })],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/^Ends on/, {}, SLOW)).toBeInTheDocument();
  },
};

export const PastDue: Story = {
  name: "Payment failed: the wall is the same",
  decorators: [portalDecorator({ portal: "portalPastDue" })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Your latest payment didn't go through.", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const Over: Story = {
  name: "The subscription is over: subscribe again",
  decorators: [portalDecorator({ portal: canceled })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Your subscription has ended.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Subscribe/ })).toBeInTheDocument();
  },
};

export const OverHard: Story = {
  name: "The subscription is over, in a dialog",
  args: { mode: "hard", onDismiss: undefined },
  decorators: [portalDecorator({ portal: canceled })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: /^Subscribe/ }, SLOW),
    ).toBeInTheDocument();
    await expect(canvasElement.querySelector("dialog[open]")).not.toBeNull();
  },
};

export const NeverSubscribed: Story = {
  name: "Never subscribed: subscribe",
  args: { entitlement: "enterprise-sso" },
  decorators: [portalDecorator({ portal: "portalNeverSubscribed" })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole("button", { name: /^Subscribe/ }, SLOW),
    ).toBeInTheDocument();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({ portal: canceled }, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Votre abonnement est terminé.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /^Souscrire/ })).toBeInTheDocument();
  },
};
