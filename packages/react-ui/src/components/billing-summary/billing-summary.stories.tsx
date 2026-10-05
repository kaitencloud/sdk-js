import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, within } from "storybook/test";

import {
  KaitenStoryProvider,
  type KaitenFetchMockScenario,
  scenarioPaywallNearLimit,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { BillingSummary } from "./billing-summary.tsx";

/**
 * `baseInstance()` sets `startLicenseDate === endLicenseDate === now`, so every
 * shared scenario resolves to a ZERO-LENGTH — therefore expired — licence term.
 * That is fine for the sections that ignore the term, but this panel's whole left
 * column is the term, so the stories give it a real window. Fixed dates rather than
 * `now`-relative ones, because the visual suite pins the rendered string.
 */
function withActiveTerm(scenario: ReturnType<typeof scenarioPortalDefault>) {
  return {
    ...scenario,
    instance: {
      ...scenario.instance,
      startLicenseDate: "2026-03-14T00:00:00.000Z",
      endLicenseDate: "2027-03-14T00:00:00.000Z",
    },
  };
}

// Module constants, not built inside the decorator: a fresh scenario object on every
// render busts `createStoryClient`'s memo and refetches the whole snapshot.
const defaultScenario = withActiveTerm(scenarioPortalDefault());
const breachedScenario = withActiveTerm(scenarioPaywallNearLimit());

/**
 * Every story carries its OWN provider and `meta` carries none.
 *
 * Nesting them does not work: the SDK detects a nested `<KaitenProvider>` with an
 * identical config and makes the INNER one a no-op, so a story that wrapped itself
 * in a second provider to swap the scenario silently kept `meta`'s. That is how the
 * quota-warning story below came to render the default fixture's 42%.
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

const meta: Meta<typeof BillingSummary> = {
  title: "Flows/BillingSummary",
  component: BillingSummary,
  args: {
    onUpgrade: action("onUpgrade"),
    footerText: "Need more volume? Quotas are uncapped on Enterprise tiers.",
    // Money, payment method and invoices are HOST-SUPPLIED — the API carries none
    // of them. See `BillingSummaryBilling`.
    billing: {
      amount: 29_900,
      currencyCode: "USD",
      interval: "month",
      paymentMethodLabel: "Visa ending in 4242",
      onManageBilling: action("onManageBilling"),
      onViewInvoices: action("onViewInvoices"),
    },
  },
};

export default meta;
type Story = StoryObj<typeof BillingSummary>;

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

/**
 * The state an adopter gets TODAY with no `billing` prop: subscription status and
 * renewal date are real (they come from the licence term), and the money block,
 * "Manage billing" and "View invoices" are simply absent.
 *
 * That absence is the design. Wiring those to the snapshot would render an empty
 * slot indistinguishable from a customer with no price — `capabilities.invoices`
 * and `capabilities.paymentMethods` are hard-coded `false` on both read paths.
 */
export const WithoutHostBillingData: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    billing: undefined,
  },
};

/** Money without the self-service actions — a read-only summary. */
export const PriceOnly: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    billing: {
      amount: 29_900,
      currencyCode: "USD",
      interval: "month",
      paymentMethodLabel: "Visa ending in 4242",
    },
  },
};

/**
 * Past 80% a quota raises the warning band, and the bar under it turns the same
 * amber — both read `ProgressBar`'s thresholds, so they cannot disagree.
 */
export const QuotaWarning: Story = {
  decorators: [shell(breachedScenario)],
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
 * The regression this component exists to avoid: with no `billing` prop, the money
 * block must not render an empty shell. Nothing about price, payment method or
 * invoices may reach the DOM.
 */
export const AbsentBillingRendersNothing: Story = {
  decorators: [shell(defaultScenario)],
  args: {
    billing: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // The API-backed half is still there. Asserted on the SLOT rather than on the
    // word "Active", so the story does not start failing the day the fixture's
    // term lapses.
    const panel = await canvas.findByRole("region", { name: /billing/i });
    await expect(panel).toBeInTheDocument();
    await expect(await canvas.findAllByRole("progressbar")).not.toHaveLength(0);

    // Nothing about money, payment method or invoices may reach the DOM.
    await expect(canvasElement.querySelector('[data-slot="billing-summary-price"]')).toBeNull();
    await expect(canvas.queryByText(/Manage billing/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/View invoices/i)).not.toBeInTheDocument();
    await expect(canvas.queryByText(/Visa ending/i)).not.toBeInTheDocument();
  },
};

/**
 * Every meter announces its real figures once. The `used / limit (pct)` caption is
 * `aria-hidden` and the same numbers ride the progressbar's accessible name.
 */
export const MetersAreAnnouncedOnce: Story = {
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
