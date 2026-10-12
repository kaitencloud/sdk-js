import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, fn, userEvent, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { PaymentMethodCard } from "./payment-method-card.tsx";

/**
 * Every story carries its own provider, built once for it, on the real session client and what
 * Kaiten answered for Initech (see `.storybook/portal-mock.tsx`). The page that adds or replaces a
 * payment method is the provider's: a story never leaves for it, and `navigate` says where it
 * would have gone.
 */
const meta: Meta<typeof PaymentMethodCard> = {
  title: "Flows/PaymentMethodCard",
  component: PaymentMethodCard,
  args: { navigate: action("navigate") },
  decorators: [
    (Story) => (
      <div className="w-full max-w-md">
        <Story />
      </div>
    ),
    portalDecorator(),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

/** The recorded portal of an active subscription, with its payment method changed. */
function portalWith(
  paymentMethod: Record<string, unknown> | null,
  change: (portal: Record<string, any>) => void = () => {},
): Record<string, any> {
  const portal: Record<string, any> = structuredClone(initechSession.portal);
  portal.paymentMethod = paymentMethod;
  change(portal);
  return portal;
}

const visa = { status: "ACTIVE", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 };

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Visa •••• 4242", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Expires 12/2030")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Update payment method" })).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Manage in billing portal" }),
    ).toBeInTheDocument();
  },
};

export const Expired: Story = {
  decorators: [portalDecorator({ portal: portalWith({ ...visa, status: "EXPIRED" }) })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Expired", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText(/This card has expired/)).toBeInTheDocument();
  },
};

export const LastPaymentFailed: Story = {
  name: "Last payment failed",
  decorators: [portalDecorator({ portal: portalWith({ ...visa, status: "FAILED" }) })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Failed", {}, SLOW)).toBeInTheDocument();
    await expect(
      canvas.getByText("Your last payment failed. Update your payment method."),
    ).toBeInTheDocument();
  },
};

export const NoPaymentMethod: Story = {
  name: "No payment method yet",
  decorators: [portalDecorator({ portal: portalWith(null) })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No payment method saved.", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Add a payment method" })).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Manage in billing portal" })).toBeNull();
  },
};

export const OtherBrand: Story = {
  name: "A brand with a name of its own",
  decorators: [
    portalDecorator({
      portal: portalWith({ ...visa, brand: "amex", last4: "0005", expMonth: 3, expYear: 2031 }),
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("American Express •••• 0005", {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const SentToTheProvider: Story = {
  name: "Sent to the provider's page",
  args: { navigate: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Update payment method" }, SLOW),
    );
    await expect(args.navigate).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//),
    );
  },
};

export const ProviderDown: Story = {
  name: "The provider cannot be reached",
  decorators: [
    portalDecorator({
      scripts: {
        "POST billing/payment-method-session": [
          {
            status: 503,
            body: {
              title: "Service Unavailable",
              status: 503,
              detail: "the payment provider could not be reached",
              code: "CreateSessionPaymentMethodSession.ProviderUnavailable",
            },
            retryAfter: 30,
          },
        ],
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole("button", { name: "Update payment method" }, SLOW),
    );
    await expect(
      await canvas.findByText(/The payment provider can't be reached/, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const NotAvailable: Story = {
  name: "Not available: the provider cannot capture one",
  decorators: [
    portalDecorator({
      portal: portalWith(null, (portal) => {
        portal.capabilities.paymentMethods = false;
      }),
    }),
  ],
  render: (args) => (
    <div className="flex flex-col gap-2">
      <p data-testid="before">Billing is handled outside Kaiten.</p>
      <PaymentMethodCard {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByTestId("before");
    // No element and no empty card: the page has the sentence before it and nothing after.
    await expect(canvas.queryByText("Payment method")).toBeNull();
    await expect(canvasElement.querySelector('[data-slot="card"]')).toBeNull();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({ portal: portalWith({ ...visa, status: "EXPIRED" }) }, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Moyen de paiement", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Expirée")).toBeInTheDocument();
  },
};

export const Unstyled: Story = {
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText("Visa •••• 4242", {}, SLOW),
    ).toBeInTheDocument();
  },
};
