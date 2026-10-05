import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  KaitenPublicStoryProvider,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { FeatureComparison } from "./feature-comparison.tsx";
import type { PricingPlan } from "../pricing-table/pricing-table.tsx";

const plans: PricingPlan[] = [
  {
    id: "starter",
    slug: "starter",
    name: "Starter",
    currencyCode: "USD",
    price: 1900,
    interval: "month",
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
    ],
  },
  {
    id: "pro",
    slug: "pro",
    name: "Pro",
    currencyCode: "USD",
    price: 7900,
    interval: "month",
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
    ],
  },
];

const comparisonScenario = scenarioPortalDefault();

const meta: Meta<typeof FeatureComparison> = {
  title: "Elements/FeatureComparison",
  component: FeatureComparison,
  decorators: [
    (Story) => (
      <KaitenPublicStoryProvider scenario={comparisonScenario}>
        <Story />
      </KaitenPublicStoryProvider>
    ),
  ],
  args: {
    plans,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filtered: Story = {
  args: {
    features: ["api_calls"],
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
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
};
