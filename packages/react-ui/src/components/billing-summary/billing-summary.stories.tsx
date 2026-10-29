// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { action } from "storybook/actions";
import { expect, within } from "storybook/test";

import {
  KaitenStoryProvider,
  type KaitenFetchMockScenario,
  type QuotaFixture,
  scenarioPaywallNearLimit,
  scenarioPortalDefault,
  scenarioQuotas,
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
 * From 80% of what the grant permits a quota raises the warning band, and the bar under it turns
 * the same amber — both read the usage rule in `shared/usage-state.ts`, so they cannot disagree.
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

// --- One story per state the usage rule tells apart ------------------------------------------------
//
// Each is a licence of numeric quotas (see `scenarioQuotas`), read by the real client, so the
// entitlements carry what the client computes for these numbers. A hard limit has no allowance; a
// soft one tolerates a percentage of its grant past it, and the API refuses usage above that ceiling.

/** A scenario with a real term, as every story of this panel needs. */
function quotas(
  list: QuotaFixture[],
  options?: { usageUnavailable?: boolean },
): KaitenFetchMockScenario {
  return withActiveTerm(scenarioQuotas(list, options));
}

const warningOf = (canvasElement: HTMLElement) =>
  canvasElement.querySelector<HTMLElement>('[data-slot="billing-summary-warning"]');

/** The bar of a quota, found by the name it is announced under: "API calls: 120 / 1,000". */
const barOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.findByRole("progressbar", { name: new RegExp(`^${name}:`) });

const healthyQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: 10_000, used: 1_200 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Well under half of a hard limit: green bars, and the panel has nothing to say. */
export const HealthyQuota: Story = {
  name: "A quota well under its limit",
  decorators: [shell(healthyQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute("data-usage-state", "healthy");
    await expect(await barOf(canvas, "Seats")).toHaveAttribute("data-usage-state", "healthy");
    await expect(warningOf(canvasElement)).toBeNull();
  },
};

const watchedQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: 10_000, used: 6_500 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Between half and 80%: still green, and still no warning. */
export const WatchedQuota: Story = {
  name: "A quota between half and 80% of its limit",
  decorators: [shell(watchedQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute("data-usage-state", "watch");
    await expect(warningOf(canvasElement)).toBeNull();
  },
};

const eightyPercentQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: 10_000, used: 8_000 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Exactly 80% of a hard limit is the first amber: the band is inclusive. */
export const EightyPercentOfAHardLimit: Story = {
  name: "Exactly 80% of a hard limit",
  decorators: [shell(eightyPercentQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "near_limit",
    );
    await expect(await canvas.findByText("API calls is at 80% of its limit.")).toBeInTheDocument();
    await expect(warningOf(canvasElement)).toHaveAttribute("data-usage-state", "near_limit");
  },
};

const nearOnSoftLimitQuotas = quotas([
  { slug: "projects", name: "Projects", limit: 100, used: 100, allowancePercent: 25 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/**
 * The grant is used up, but its 25% allowance leaves room to 125: what is consumed is 80% of what
 * the API accepts, so the quota is near its wall, not on it, and the hatched band shows the room left.
 */
export const NearLimitOnASoftLimit: Story = {
  name: "A soft limit used up to its grant, near its ceiling",
  decorators: [shell(nearOnSoftLimitQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "near_limit");
    // Near on the ceiling (100 of 125); the sentence quotes the row's figure, of the grant.
    await expect(await canvas.findByText("Projects is at 100% of its limit.")).toBeInTheDocument();
    await expect(warningOf(canvasElement)).toHaveAttribute("data-usage-state", "near_limit");
  },
};

const inAllowanceQuotas = quotas([
  { slug: "projects", name: "Projects", limit: 100, used: 110, allowancePercent: 20 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Past the grant, inside the allowance: served, so amber, and 110% of the grant is the truth. */
export const InAllowance: Story = {
  name: "Past the grant, inside the allowance",
  decorators: [shell(inAllowanceQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await barOf(canvas, "Projects");
    await expect(bar).toHaveAttribute("data-usage-state", "in_allowance");
    // The bar's track runs to the ceiling (120), and a tick marks the grant.
    await expect(bar).toHaveAttribute("aria-valuemax", "120");
    await expect(bar.querySelector('[data-segment="band"]')).not.toBeNull();
    await expect(bar.querySelector('[data-segment="grant"]')).not.toBeNull();
    await expect(
      await canvas.findByText("Projects is past its included amount, within its allowance."),
    ).toBeInTheDocument();
    await expect(canvas.getByText(/110 \/ 100 \(110\s?%\)/)).toBeInTheDocument();
    await expect(warningOf(canvasElement)).toHaveAttribute("data-usage-state", "in_allowance");
  },
};

const wideAllowanceQuotas = quotas([
  { slug: "projects", name: "Projects", limit: 100, used: 105, allowancePercent: 50 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/**
 * A wide allowance leaves the saturation low (105 of a ceiling of 150 is 0.70): the quota is in its
 * allowance all the same, because the grant is spent, whatever the bar's fill says.
 */
export const InAllowanceWithAWideAllowance: Story = {
  name: "Inside a wide allowance, with the bar still low",
  decorators: [shell(wideAllowanceQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bar = await barOf(canvas, "Projects");
    await expect(bar).toHaveAttribute("data-usage-state", "in_allowance");
    await expect(bar).toHaveAttribute("aria-valuemax", "150");
    await expect(
      await canvas.findByText("Projects is past its included amount, within its allowance."),
    ).toBeInTheDocument();
  },
};

/** The same, in the dark theme: the amber band and the tick must read on a dark surface. */
export const InAllowanceDark: Story = {
  name: "Inside the allowance, in the dark theme",
  decorators: [shell(inAllowanceQuotas)],
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "Projects")).toHaveAttribute(
      "data-usage-state",
      "in_allowance",
    );
    await expect(
      await canvas.findByText("Projects is past its included amount, within its allowance."),
    ).toBeInTheDocument();
  },
};

const limitReachedQuotas = quotas([
  { slug: "projects", name: "Projects", limit: 100, used: 120, allowancePercent: 20 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Usage on the ceiling of a soft limit: the last accepted report, so the quota is spent. Red. */
export const LimitReachedOnASoftLimit: Story = {
  name: "On the ceiling of a soft limit",
  decorators: [shell(limitReachedQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "at_limit");
    await expect(await canvas.findByText("Projects has reached its limit.")).toBeInTheDocument();
    await expect(warningOf(canvasElement)).toHaveAttribute("data-usage-state", "at_limit");
  },
};

const overLimitQuotas = quotas([
  { slug: "projects", name: "Projects", limit: 100, used: 130, allowancePercent: 20 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
]);

/** Past the ceiling, as when a limit was lowered under what was already consumed. Red. */
export const OverLimit: Story = {
  name: "Past the ceiling, after the limit was lowered",
  decorators: [shell(overLimitQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "over_limit");
    await expect(await canvas.findByText("Projects is over its limit.")).toBeInTheDocument();
    await expect(warningOf(canvasElement)).toHaveAttribute("data-usage-state", "over_limit");
  },
};

const severalAtRiskQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: 1_000, used: 850 },
  { slug: "seats", name: "Seats", limit: 25, used: 26, allowancePercent: 25 },
  { slug: "storage", name: "Storage", limit: 100, used: 130, allowancePercent: 20 },
  { slug: "projects", name: "Projects", limit: 50, used: 10 },
]);

/**
 * Three quotas call for a look at once. The panel has room for one sentence, and it is about the
 * worst: Storage is past its ceiling, though API calls and Seats are listed before it.
 */
export const SeveralQuotasAtRisk: Story = {
  name: "Several quotas at risk, the worst one speaks",
  decorators: [shell(severalAtRiskQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "near_limit",
    );
    await expect(await barOf(canvas, "Seats")).toHaveAttribute("data-usage-state", "in_allowance");
    await expect(await barOf(canvas, "Storage")).toHaveAttribute("data-usage-state", "over_limit");
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "healthy");
    await expect(await canvas.findByText("Storage is over its limit.")).toBeInTheDocument();
    await expect(
      canvasElement.querySelectorAll('[data-slot="billing-summary-warning"]'),
    ).toHaveLength(1);
    await expect(canvas.queryByText(/API calls is at/)).toBeNull();
  },
};

const manyQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: 10_000, used: 1_200 },
  { slug: "seats", name: "Seats", limit: 25, used: 5 },
  { slug: "builds", name: "Builds", limit: 100, used: 20 },
  { slug: "projects", name: "Projects", limit: 50, used: 10 },
  { slug: "storage", name: "Storage", limit: 20, used: 3 },
  // Listed after the fourth, and past its limit: the summary shows four meters (the entitlements
  // come sorted by name), and a quota it does not show does not raise its warning.
  { slug: "webhooks", name: "Webhooks", limit: 10, used: 12 },
]);

/** Six metered quotas and the default of four meters: the rest stay in `UsageMeters`. */
export const MoreQuotasThanMaxMeters: Story = {
  name: "More metered quotas than the panel shows",
  decorators: [shell(manyQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Projects");
    await expect(await canvas.findAllByRole("progressbar")).toHaveLength(4);
    await expect(canvas.queryByText("Storage")).toBeNull();
    await expect(canvas.queryByText("Webhooks")).toBeNull();
    await expect(warningOf(canvasElement)).toBeNull();
  },
};

const unreadableQuotas = quotas(
  [
    { slug: "api_calls", name: "API calls", limit: 100, used: 100 },
    { slug: "seats", name: "Seats", limit: 25, used: 25 },
  ],
  { usageUnavailable: true },
);

/**
 * The usage read failed: what the customer has consumed is unknown, which is not zero. The row says
 * so in place of "0 / 100" and a bar of nothing, and no warning is raised on a guess either way.
 */
export const UsageUnavailable: Story = {
  name: "A usage read that failed",
  decorators: [shell(unreadableQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls");
    await expect(
      canvasElement.querySelectorAll('[data-slot="billing-summary-unavailable"]'),
    ).toHaveLength(2);
    await expect(canvas.queryAllByRole("progressbar")).toHaveLength(0);
    await expect(canvas.queryByText(/^0 \/ /)).toBeNull();
    await expect(warningOf(canvasElement)).toBeNull();
  },
};

const unlimitedQuotas = quotas([
  { slug: "api_calls", name: "API calls", limit: -1, used: 48_000 },
  { slug: "seats", name: "Seats", limit: -1, used: 900 },
]);

/** Nothing caps these quotas, so there is nothing to measure and nothing to warn about. */
export const UnlimitedQuotasOnly: Story = {
  name: "Unlimited quotas only",
  decorators: [shell(unlimitedQuotas)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("No metered quota on this plan.")).toBeInTheDocument();
    await expect(canvas.queryAllByRole("progressbar")).toHaveLength(0);
    await expect(warningOf(canvasElement)).toBeNull();
  },
};
