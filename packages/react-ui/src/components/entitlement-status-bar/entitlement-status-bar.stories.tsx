import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, within } from "storybook/test";

import {
  KaitenStoryProvider,
  type KaitenFetchMockScenario,
  scenarioPaywallNearLimit,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { EntitlementStatusBar } from "./entitlement-status-bar.tsx";

const defaultScenario = scenarioPortalDefault();
const nearLimitScenario = scenarioPaywallNearLimit();

/**
 * Five metered quotas — the shape a real host produces, not a worst case.
 *
 * How many meters the bar renders is the HOST's decision (`entitlements: string[]`),
 * and every other story here shows the same two. Two fit anywhere, so the suite in
 * `tests/layout` reported the bar as sound at 320px while the row it is built from
 * cannot wrap and its meters cannot shrink past their labels. A layout invariant only
 * covers what some story actually renders; this is the fixture that makes the
 * assertion mean something.
 *
 * Derived from `scenarioPortalDefault()` by cloning its own NUMBER entitlement and
 * usage row, so the shapes stay correct by construction as the mock evolves.
 */
const crowdedScenario: KaitenFetchMockScenario = (() => {
  const base = scenarioPortalDefault();
  const meteredEntitlement = base.entitlements.find((e) => e.entitlementType === "NUMBER");
  const usageRow = base.usageRows[0];
  if (!meteredEntitlement || !usageRow) throw new Error("portal scenario lost its metered quota");

  const extra = [
    { name: "Storage", slug: "storage", limit: 500, used: 410 },
    { name: "Webhooks", slug: "webhooks", limit: 50, used: 31 },
    { name: "Build minutes", slug: "build_minutes", limit: 2_000, used: 1_450 },
  ];

  return {
    ...base,
    entitlements: [
      ...base.entitlements,
      ...extra.map((quota) => ({
        ...meteredEntitlement,
        entitlementName: quota.name,
        entitlementSlug: quota.slug,
        value: { type: "number" as const, value: quota.limit },
      })),
    ],
    usageRows: [
      ...base.usageRows,
      ...extra.map((quota) => ({
        ...usageRow,
        entitlementId: `e-${quota.slug}`,
        entitlementSlug: quota.slug,
        value: { type: "number" as const, value: quota.used },
      })),
    ],
  };
})();

/**
 * Each story carries its OWN provider, and `meta` carries none. A nested
 * `<KaitenProvider>` with an identical config is detected by the SDK and the INNER
 * one becomes a no-op — so a story that wrapped itself in a second provider to swap
 * the scenario silently kept `meta`'s, which is exactly what `NearLimit` did.
 */
function shell(scenario: KaitenFetchMockScenario, simulateLoading = false) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <KaitenStoryProvider scenario={scenario} simulateLoading={simulateLoading}>
        <Story />
      </KaitenStoryProvider>
    );
  };
}

const meta: Meta<typeof EntitlementStatusBar> = {
  title: "Elements/EntitlementStatusBar",
  component: EntitlementStatusBar,
  args: {
    onUpgrade: action("onUpgrade"),
  },
};

export default meta;
type Story = StoryObj<typeof EntitlementStatusBar>;

export const Default: Story = {
  decorators: [shell(defaultScenario)],
};

export const Dark: Story = {
  decorators: [shell(defaultScenario)],
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
};

/** No trailing action: the bar is read-only chrome unless the host wires `onUpgrade`. */
export const WithoutAction: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    onUpgrade: undefined,
  },
};

export const WithoutBrand: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    hideBrand: true,
  },
};

/**
 * Past 80% the label and the fill both change tone, and they read the SAME threshold
 * — the label tone mirrors `ProgressBar`'s own bands rather than re-deriving them.
 */
export const NearLimit: Story = {
  decorators: [shell(nearLimitScenario)],
};

/**
 * The bar with as many quotas as a host plausibly wires. Pick a container width from
 * the toolbar to see where it stops fitting: the row is `flex` with no `flex-wrap`,
 * so past its natural width it does not reflow, it leaves the box.
 */
export const Crowded: Story = {
  decorators: [shell(crowdedScenario)],
};

export const Loading: Story = {
  decorators: [shell(defaultScenario, true)],
};

export const Unstyled: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    unstyled: true,
  },
};

/**
 * Every meter must expose its real figures to a screen reader. The compact caption
 * ("4.2k/10k") is decoration over the same numbers, so the progressbar carries the
 * accessible name and the caption is hidden — otherwise the row is announced twice,
 * the second time in an abbreviation.
 */
export const MetersAreAccessible: Story = {
  decorators: [shell(defaultScenario)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bars = await canvas.findAllByRole("progressbar");
    await expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      await expect(bar).toHaveAccessibleName(/\d/);
    }
  },
};
