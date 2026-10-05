import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";

import {
  KaitenPublicStoryProvider,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { PricingTable, type PricingPlan } from "./pricing-table.tsx";

const basePlans: PricingPlan[] = [
  {
    id: "starter",
    slug: "starter",
    name: "Starter",
    description: "For solo builders and small projects.",
    price: 1900,
    annualPrice: 19000,
    currencyCode: "USD",
    interval: "month",
    features: ["1 instance", "Basic entitlements", "Community support"],
    entitlements: [
      {
        slug: "api_calls",
        name: "API calls",
        type: "number",
        value: { type: "number", value: 1000 },
        category: "Quota",
      },
      {
        slug: "audit_logs",
        name: "Audit logs",
        type: "boolean",
        value: { type: "boolean", value: false },
        category: "Security",
      },
      {
        slug: "sso",
        name: "SSO / SAML",
        type: "boolean",
        value: { type: "boolean", value: false },
        category: "Security",
      },
    ],
  },
  {
    id: "pro",
    slug: "pro",
    name: "Pro",
    description: "Best for growing teams.",
    price: 7900,
    annualPrice: 79000,
    currencyCode: "USD",
    interval: "month",
    highlighted: true,
    badge: "Popular",
    features: ["10 instances", "Advanced usage limits", "Priority support"],
    entitlements: [
      {
        slug: "api_calls",
        name: "API calls",
        type: "number",
        value: { type: "number", value: 10000 },
        category: "Quota",
      },
      {
        slug: "audit_logs",
        name: "Audit logs",
        type: "boolean",
        value: { type: "boolean", value: true },
        category: "Security",
      },
      {
        slug: "sso",
        name: "SSO / SAML",
        type: "boolean",
        value: { type: "boolean", value: false },
        category: "Security",
      },
    ],
  },
  {
    id: "enterprise",
    slug: "enterprise",
    name: "Enterprise",
    description: "Custom controls and scale.",
    price: 24900,
    annualPrice: 249000,
    currencyCode: "USD",
    interval: "month",
    features: ["Unlimited instances", "SAML/SSO", "Dedicated success manager"],
    entitlements: [
      {
        slug: "api_calls",
        name: "API calls",
        type: "number",
        value: { type: "number", value: 100000 },
        category: "Quota",
      },
      {
        slug: "audit_logs",
        name: "Audit logs",
        type: "boolean",
        value: { type: "boolean", value: true },
        category: "Security",
      },
      {
        slug: "sso",
        name: "SSO / SAML",
        type: "boolean",
        value: { type: "boolean", value: true },
        category: "Security",
      },
    ],
  },
];

const fourthPlan: PricingPlan = {
  id: "scale",
  slug: "scale",
  name: "Scale",
  description: "High-volume and custom needs.",
  price: 49900,
  annualPrice: 499000,
  currencyCode: "USD",
  interval: "month",
  entitlements: [
    {
      slug: "api_calls",
      name: "API calls",
      type: "number",
      value: { type: "number", value: 500000 },
      category: "Quota",
    },
    {
      slug: "audit_logs",
      name: "Audit logs",
      type: "boolean",
      value: { type: "boolean", value: true },
      category: "Security",
    },
    {
      slug: "sso",
      name: "SSO / SAML",
      type: "boolean",
      value: { type: "boolean", value: true },
      category: "Security",
    },
  ],
};

const pricingScenario = scenarioPortalDefault();

const meta: Meta<typeof PricingTable> = {
  title: "Elements/PricingTable",
  component: PricingTable,
  decorators: [
    (Story) => (
      <KaitenPublicStoryProvider scenario={pricingScenario}>
        <Story />
      </KaitenPublicStoryProvider>
    ),
  ],
  args: {
    plans: basePlans,
    onSelectPlan: action("onSelectPlan"),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A play function with assertions on a high-stakes interaction (the
// monthly⇄annual billing toggle that drives the displayed price).
export const AnnualToggleInteraction: Story = {
  name: "Annual toggle (interaction)",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const monthly = await canvas.findByRole("radio", { name: /monthly/i });
    const annual = await canvas.findByRole("radio", { name: /annual/i });

    // Monthly is selected by default; no annual ("/year") period label shown.
    await expect(monthly).toBeChecked();
    await expect(canvas.queryAllByText(/\/year/i)).toHaveLength(0);

    // Switching to annual flips the selection and the displayed billing period.
    await userEvent.click(annual);
    await expect(annual).toBeChecked();
    await expect(monthly).not.toBeChecked();
    await expect(canvas.getAllByText(/\/year/i).length).toBeGreaterThan(0);
  },
};

export const HighlightStarter: Story = {
  args: {
    highlightPlan: "starter",
  },
};

export const TwoPlans: Story = {
  args: {
    plans: basePlans.slice(0, 2),
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
};

export const SeparateLayout: Story = {
  args: {
    sectionLayout: "separate",
  },
};

export const WithAnnualToggle: Story = {
  args: {
    showAnnualToggle: true,
  },
};

export const FourColumns: Story = {
  args: {
    plans: [...basePlans, fourthPlan],
    numberOfColumns: 4,
  },
};

export const CustomCtaText: Story = {
  args: {
    ctaText: (plan) => `Get ${plan.name}`,
  },
};

export const WithHeader: Story = {
  args: {
    headerText: "Choose your plan",
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
    unstyled: true,
    showFeatureComparison: false,
  },
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Mock fetch is delayed for ~10s so the loading skeletons of the pricing table remain visible.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenPublicStoryProvider scenario={pricingScenario} simulateLoading={10000}>
        <Story />
      </KaitenPublicStoryProvider>
    ),
  ],
  args: {
    plans: undefined,
  },
};
