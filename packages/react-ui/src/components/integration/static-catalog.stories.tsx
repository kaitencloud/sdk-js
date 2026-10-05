import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";

import { demoCatalog } from "@kaitencloud/client/testing";
import { KaitenProvider } from "@kaitencloud/react";
import { KaitenStyleRoot } from "../../style-root/kaiten-style-root.tsx";
import { FeatureCatalog } from "../feature-catalog/feature-catalog.tsx";
import { PricingTable } from "../pricing-table/pricing-table.tsx";

// Hoisted: the provider keys its scope on the catalog's plan slugs and its
// consumers follow the object's identity, so a literal inside a story function
// would be a new catalog on every render.
const catalog = demoCatalog();

const meta: Meta = {
  title: "Integration/Static catalog",
  parameters: {
    docs: {
      description: {
        component:
          'The marketing-site path. The host holds the catalog — fetched server-side, generated at build time, or written by hand — and hands it to `mode="static"`: no key, no client, no request, no polling. Same components as the live modes; only the provider differs. The fixture includes an unpublished internal licence, which the pricing table keeps off the page.',
      },
    },
  },
};

export default meta;

type Story = StoryObj;

export const PricingPage: Story = {
  render: () => (
    <KaitenProvider mode="static" catalog={catalog}>
      <KaitenStyleRoot>
        <PricingTable
          eyebrowText="Pricing"
          headerText="Choose the right plan"
          onSelectPlan={action("onSelectPlan")}
        />
      </KaitenStyleRoot>
    </KaitenProvider>
  ),
};

export const FeaturePage: Story = {
  render: () => (
    <KaitenProvider mode="static" catalog={catalog}>
      <KaitenStyleRoot>
        <FeatureCatalog searchable filterable onSelectFeature={action("onSelectFeature")} />
      </KaitenStyleRoot>
    </KaitenProvider>
  ),
};
