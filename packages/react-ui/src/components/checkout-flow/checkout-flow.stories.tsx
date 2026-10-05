import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";

import { KaitenStoryProvider, scenarioPortalDefault } from "../../../.storybook/kaiten-mock.tsx";
import { CheckoutSummary, type CheckoutItem } from "./checkout-flow.tsx";

const planOnlyItems: CheckoutItem[] = [
  {
    slug: "pro",
    name: "Pro Plan",
    price: 7900,
    currencyCode: "USD",
    interval: "month",
    type: "plan",
  },
];

const withAddonsItems: CheckoutItem[] = [
  ...planOnlyItems,
  {
    slug: "audit-log",
    name: "Audit Log",
    price: 2000,
    currencyCode: "USD",
    interval: "month",
    type: "addon",
  },
  {
    slug: "priority-support",
    name: "Priority Support",
    price: 3500,
    currencyCode: "USD",
    interval: "month",
    type: "addon",
  },
];

const checkoutScenario = scenarioPortalDefault();

const meta: Meta<typeof CheckoutSummary> = {
  title: "Flows/CheckoutSummary",
  component: CheckoutSummary,
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={checkoutScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  args: {
    items: planOnlyItems,
    onCheckout: action("onCheckout"),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const PlanOnly: Story = {};

export const PlanAndAddons: Story = {
  args: {
    items: withAddonsItems,
  },
};

export const AsyncCheckout: Story = {
  args: {
    items: withAddonsItems,
    onCheckout: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    },
  },
};

export const WithCancelButton: Story = {
  args: {
    items: planOnlyItems,
    onCancel: action("onCancel"),
  },
};

export const CheckoutError: Story = {
  args: {
    items: planOnlyItems,
    onCheckout: async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      throw new Error("Payment method declined. Please check your card details.");
    },
  },
};

export const Unstyled: Story = {
  parameters: {
    docs: {
      description: {
        story: "Headless mode — bring your own styles. All styling is removed (`unstyled={true}`).",
      },
    },
  },
  args: {
    items: withAddonsItems,
    unstyled: true,
    onCancel: action("onCancel"),
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
  args: {
    items: withAddonsItems,
  },
};
