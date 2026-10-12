import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";

import {
  acmeCatalog,
  KaitenPublicStoryProvider,
  KaitenServedCatalogStoryProvider,
  originNotAllowedReply,
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

// The catalog as the billing API serves it: default prices beside a quarterly
// one, and a plan that is not self-serve. The quarterly price never shows under
// "/month", and Enterprise links to its contact page instead of offering a plan
// nobody can buy by themselves.
const billingPrice = (
  id: string,
  amount: number,
  interval: "month" | "year",
  intervalCount?: number,
) => ({
  id,
  amount,
  unitAmountDecimal: `${amount}`,
  currencyCode: "EUR",
  interval,
  ...(intervalCount ? { intervalCount } : {}),
  billingModel: "FLAT_FEE",
  isDefault: true,
});

const billingPlans: PricingPlan[] = [
  {
    slug: "starter-v1",
    name: "Starter",
    description: "For solo builders and small projects.",
    currencyCode: "EUR",
    prices: [
      billingPrice("lp-starter-m", 1900, "month"),
      billingPrice("lp-starter-y", 19000, "year"),
    ],
    features: ["Community support"],
    pricingType: "PAID",
    selfServe: true,
    selfServeCtaUrl: null,
  },
  {
    slug: "pro-v2",
    name: "Pro",
    description: "Best for growing teams.",
    currencyCode: "EUR",
    prices: [
      billingPrice("lp-pro-q", 13500, "month", 3),
      billingPrice("lp-pro-m", 4900, "month"),
      billingPrice("lp-pro-y", 49000, "year"),
    ],
    features: ["Priority support"],
    highlighted: true,
    pricingType: "PAID",
    selfServe: true,
    selfServeCtaUrl: null,
  },
  {
    slug: "enterprise-v1",
    name: "Enterprise",
    description: "Volume pricing and a dedicated contact.",
    features: ["SSO / SAML", "Dedicated support"],
    pricingType: "CUSTOM",
    selfServe: false,
    selfServeCtaUrl: "https://example.com/contact",
  },
];

export const BillingCatalog: Story = {
  name: "Billing catalog",
  args: {
    plans: billingPlans,
    showFeatureComparison: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("€49.00")).toBeInTheDocument();
    await expect(canvas.queryByText("€135.00")).toBeNull();
    await expect(canvas.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "https://example.com/contact",
    );
  },
};

// The catalogue Kaiten serves for Acme, read by the real client: 8 plans in euros, yen and
// dinars, in the order it serves them. Only Pro sells an annual fee, and it also sells a
// quarterly one and two usage prices, none of which is its headline; Enterprise is sold by
// contact, and Solo has no default fee. The yen have no decimals, the dinars three.
const servedCatalog = { status: 200, body: acmeCatalog };

export const BillingV3: Story = {
  name: "Billing v3",
  decorators: [
    (Story) => (
      <KaitenServedCatalogStoryProvider reply={servedCatalog}>
        <Story />
      </KaitenServedCatalogStoryProvider>
    ),
  ],
  // No `plans`: the table reads the catalogue itself. (An `undefined` arg does not unset
  // the one the meta gives, so the story renders it without.)
  render: (args) => <PricingTable {...args} plans={undefined} />,
  args: {
    showFeatureComparison: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Starter")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-slot="card-title"]')).toHaveLength(8);
    await expect(canvas.getByText("¥980")).toBeInTheDocument();
    await expect(canvas.getByText("KWD 12.500")).toBeInTheDocument();
    // The monthly fee, and not the quarterly one, is Pro's price.
    await expect(canvas.getByText("€49.00")).toBeInTheDocument();
    await expect(canvas.queryByText("€135.00")).toBeNull();
    await expect(canvas.getByRole("link", { name: "Contact us" })).toHaveAttribute(
      "href",
      "https://acme.test/contact",
    );
  },
};

// A publishable key used from a page its owner did not allow: the catalogue read answers
// 403 `PublicAuth.OriginNotAllowed`. The visitor gets an error they can retry, never an
// empty page that reads like a shop with nothing in it. (Retrying is tested in
// `tests/pricing-table-served-catalog.test.tsx`, where the second answer can differ.)
export const OriginNotAllowed: Story = {
  name: "Origin not allowed",
  decorators: [
    (Story) => (
      <KaitenServedCatalogStoryProvider reply={originNotAllowedReply}>
        <Story />
      </KaitenServedCatalogStoryProvider>
    ),
  ],
  render: (args) => <PricingTable {...args} plans={undefined} />,
  args: {
    showFeatureComparison: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("alert")).toBeInTheDocument();
    await expect(canvasElement.querySelectorAll('[data-slot="card-title"]')).toHaveLength(0);
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeInTheDocument();
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
