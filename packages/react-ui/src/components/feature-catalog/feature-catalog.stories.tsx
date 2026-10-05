import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";

import {
  KaitenPublicStoryProvider,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import type { Plan } from "@kaitencloud/react";
import { FeatureCatalog } from "./feature-catalog.tsx";

/**
 * `tags` carries the entitlement's GROUP SLUGS. A slug that names a lifecycle stage
 * ("beta", "new", …) is what puts the badge on the card — no schema field, just a
 * group named for the stage. Anything else in `tags` is ignored.
 */
const catalogPlans: Plan[] = [
  {
    id: "cloud-team",
    slug: "cloud-team",
    name: "Cloud Team",
    entitlements: [
      {
        slug: "feature_flags",
        name: "Feature Flags",
        type: "boolean",
        description: "Manage dynamic runtime variables at local cache speeds.",
        category: "Core Platform",
        tags: ["core-platform", "ga"],
      },
      {
        slug: "ai_control_plane",
        name: "AI Control Plane",
        type: "boolean",
        description: "Route LLM calls dynamically based on performance quotas.",
        category: "AI & Analytics",
        tags: ["ai-analytics", "beta"],
      },
      {
        slug: "audit_trail",
        name: "Audit Trail",
        type: "boolean",
        description: "Immutable logs recording every event and administrative trace.",
        category: "Security",
        tags: ["security", "ga"],
      },
      {
        slug: "webhook_events",
        name: "Webhook Events",
        type: "boolean",
        description: "Trigger third-party pipelines instantly with zero event latency.",
        category: "Integrations",
        tags: ["integrations", "ga"],
      },
      {
        slug: "credit_system",
        name: "Credit System",
        type: "boolean",
        description: "Self-service engine allocation limits for cloud credit control.",
        category: "AI & Analytics",
        tags: ["ai-analytics", "new"],
      },
      {
        slug: "api_gateway",
        name: "API Gateway",
        type: "boolean",
        description: "Direct REST and GraphQL query sync engines built for speed.",
        category: "Core Platform",
        tags: ["core-platform", "coming-soon"],
      },
      {
        // No lifecycle slug in `tags`: the card shows no stage rather than
        // defaulting to one.
        slug: "internal_counter",
        name: "Edge Deployments",
        type: "boolean",
        description: "Sub-1ms worldwide flag evaluations globally routed.",
        category: "Core Platform",
        tags: ["core-platform"],
      },
    ],
  },
  {
    id: "enterprise",
    slug: "enterprise",
    name: "Enterprise",
    entitlements: [
      {
        slug: "feature_flags",
        name: "Feature Flags",
        type: "boolean",
        description: "Manage dynamic runtime variables at local cache speeds.",
        category: "Core Platform",
        tags: ["core-platform", "ga"],
      },
      {
        slug: "sso_saml",
        name: "SSO & SAML",
        type: "boolean",
        description: "Federated enterprise compliance identity provider mappings.",
        category: "Security",
        tags: ["security", "new"],
      },
    ],
  },
];

const meta: Meta<typeof FeatureCatalog> = {
  title: "Elements/FeatureCatalog",
  component: FeatureCatalog,
  decorators: [
    (Story) => (
      <KaitenPublicStoryProvider scenario={scenarioPortalDefault()}>
        <Story />
      </KaitenPublicStoryProvider>
    ),
  ],
  args: {
    plans: catalogPlans,
    onSelectFeature: action("onSelectFeature"),
  },
};

export default meta;
type Story = StoryObj<typeof FeatureCatalog>;

export const Default: Story = {};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
};

export const WithoutSearch: Story = {
  args: {
    searchable: false,
  },
};

export const WithoutFilters: Story = {
  args: {
    filterable: false,
  },
};

export const Unstyled: Story = {
  args: {
    unstyled: true,
  },
};

/**
 * A feature granted by several plans is ONE card listing them all, not one card per
 * plan — the catalog is the transpose of the plan list, and duplicating "Feature
 * Flags" for every tier it appears in was the obvious wrong shape.
 */
export const SharedFeatureIsListedOnce: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    const titles = await canvas.findAllByText("Feature Flags");
    await expect(titles).toHaveLength(1);

    // Scoped to the card, not the page: every tier's name appears as a pill on
    // several cards, so a page-wide `getByText("Cloud Team")` matches many nodes.
    // What this story is about is that BOTH plans are listed on the ONE card.
    const card = titles[0]?.closest('[data-slot="card"]');
    await expect(card).not.toBeNull();
    const inCard = within(card as HTMLElement);
    await expect(inCard.getByText("Cloud Team")).toBeInTheDocument();
    await expect(inCard.getByText("Enterprise")).toBeInTheDocument();
  },
};

export const SearchFiltersCards: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const search = await canvas.findByRole("searchbox");
    await userEvent.type(search, "webhook");
    await expect(await canvas.findByText("Webhook Events")).toBeInTheDocument();
    await expect(canvas.queryByText("Audit Trail")).not.toBeInTheDocument();
  },
};

export const CategoryFilterNarrowsTheGrid: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const securityPill = await canvas.findByRole("button", { name: "Security" });
    await userEvent.click(securityPill);
    await expect(securityPill).toHaveAttribute("aria-pressed", "true");
    await expect(await canvas.findByText("Audit Trail")).toBeInTheDocument();
    await expect(canvas.queryByText("Feature Flags")).not.toBeInTheDocument();
  },
};
