// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, within } from "storybook/test";

import {
  initechSession,
  KaitenSessionStoryProvider,
  KaitenStoryProvider,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import {
  CurrentPlan,
  CustomerPortal,
  IncludedFeatures,
  type CustomerPortalProps,
} from "./customer-portal.tsx";

const portalScenario = scenarioPortalDefault();

/** Story-only args consumed by the meta decorator (not forwarded to `CustomerPortal`). */
type CustomerPortalStoryArgs = CustomerPortalProps & {
  hideBranding?: boolean;
  simulateLoading?: boolean | number;
};

function storyScenario(hideBranding: boolean): ReturnType<typeof scenarioPortalDefault> {
  if (hideBranding) {
    return { ...portalScenario, branding: { removable: true } };
  }
  return portalScenario;
}

const meta = {
  title: "Flows/CustomerPortal",
  component: CustomerPortal,
  parameters: {
    docs: {
      description: {
        component:
          "Use **Controls → Kaiten mock → hide branding** to preview white-label. This sets `KaitenProvider` `hideBranding` and bumps the mock to `branding.removable: true` so `KaitenBranding` can actually disappear.",
      },
    },
  },
  argTypes: {
    hideBranding: {
      control: "boolean",
      description:
        "When enabled, hides “Powered by Kaiten” wherever `KaitenBranding` is rendered (requires removable branding in the mock).",
      table: { category: "Kaiten mock" },
    },
    simulateLoading: {
      control: "select",
      options: [false, true, 10_000],
      labels: { false: "Off", true: "Default delay (~1.5s)", 10_000: "10s (inspect skeletons)" },
      description: "Artificial fetch delay for loading states (Storybook mock only).",
      table: { category: "Kaiten mock" },
    },
  },
  args: {
    hideBranding: false,
    simulateLoading: false,
  },
  render: (args: CustomerPortalStoryArgs) => {
    const { hideBranding: _hide, simulateLoading: _sim, ...portalProps } = args;
    return <CustomerPortal {...portalProps} />;
  },
  decorators: [
    (Story, context) => {
      const args = context.args as CustomerPortalStoryArgs;
      const hideBranding = Boolean(args.hideBranding);
      const rawSim = args.simulateLoading;
      const simulateLoading =
        rawSim === undefined || rawSim === false ? undefined : rawSim === true ? true : rawSim;

      return (
        <KaitenStoryProvider
          scenario={storyScenario(hideBranding)}
          hideBranding={hideBranding}
          simulateLoading={simulateLoading}
        >
          <Story />
        </KaitenStoryProvider>
      );
    },
  ],
} satisfies Meta<CustomerPortalStoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Full: Story = {
  // FlagsSummary is opt-in (not a default element), so "Full" lists it explicitly
  // to showcase every section the portal can compose.
  args: { elements: ["CurrentPlan", "IncludedFeatures", "UsageMeters", "AddOns", "FlagsSummary"] },
  // Read-only play (assertions, no interaction → leaves the visual baseline
  // unchanged) verifying the full portal actually composes its sections from the
  // snapshot rather than rendering blank/skeletons.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Current plan");
    for (const section of ["Current plan", "Usage meters", "Feature flags"]) {
      await expect(canvas.queryAllByText(section).length).toBeGreaterThan(0);
    }
    await expect(canvas.queryByText(/Failed to load/i)).not.toBeInTheDocument();
  },
};

export const LicenseOnly: Story = {
  args: {
    elements: ["CurrentPlan"],
  },
};

export const EntitlementsAndUsage: Story = {
  args: {
    elements: ["IncludedFeatures", "UsageMeters"],
  },
};

export const Vertical: Story = {
  args: {
    layout: "vertical",
  },
};

export const WithCallbacks: Story = {
  args: {
    onUpgradeVersion: action("onUpgradeVersion"),
    onAddQuota: action("onAddQuota"),
    onAddAddOn: action("onAddAddOn"),
    onManageAddon: action("onManageAddon"),
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
    elements: ["CurrentPlan", "UsageMeters"],
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
};

export const Loading: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Mock fetch is delayed so skeleton loaders stay visible long enough to inspect. Adjust **Kaiten mock → simulate loading** in Controls, or keep the default 10s preset below.",
      },
    },
  },
  args: {
    simulateLoading: 10_000,
  },
};

export const StandaloneSection: Story = {
  name: "Standalone section (with branding)",
  parameters: {
    docs: {
      description: {
        story:
          "Each section card includes the integrated `Powered by Kaiten` footer. Toggle **hide branding** in Controls (with removable mock) to match white-label embeds.",
      },
    },
  },
  render: () => (
    <div className="w-full max-w-md">
      <CurrentPlan />
    </div>
  ),
};

export const StandaloneSectionsStacked: Story = {
  name: "Standalone sections — branding per card",
  parameters: {
    docs: {
      description: {
        story:
          "When sections are used outside of `CustomerPortal`, each card carries its own attribution footer by default, matching the `CheckoutSummary` visual.",
      },
    },
  },
  render: () => (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <CurrentPlan />
      <IncludedFeatures />
    </div>
  ),
};

// A customer session has no licence: the portal names the plan and the subscription, and
// CurrentPlan says what the portal says. The portals are the ones Kaiten serves for Initech.
export const CurrentPlanInASession: Story = {
  name: "Current plan in a customer session",
  decorators: [
    (Story) => (
      <KaitenSessionStoryProvider portal={initechSession.portal}>
        <Story />
      </KaitenSessionStoryProvider>
    ),
  ],
  render: () => <CurrentPlan />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Pro")).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-slot="current-plan-price"]')).toHaveTextContent(
      "€49.00/month",
    );
    await expect(canvas.getByText(/^Renews on/)).toBeInTheDocument();
  },
};

export const CurrentPlanInASessionQuarterly: Story = {
  name: "Current plan in a customer session, quarterly and past due",
  decorators: [
    (Story) => (
      <KaitenSessionStoryProvider portal={initechSession.portalPastDue}>
        <Story />
      </KaitenSessionStoryProvider>
    ),
  ],
  render: () => <CurrentPlan />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText("Pro")).toBeInTheDocument();
    await expect(canvasElement.querySelector('[data-slot="current-plan-price"]')).toHaveTextContent(
      "€135.00 every 3 months",
    );
    // A subscription past due is not said to renew.
    await expect(canvas.queryByText(/^Renews on/)).toBeNull();
  },
};
