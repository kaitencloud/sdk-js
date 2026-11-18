// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import {
  baseLicense,
  KaitenStoryProvider,
  scenarioGateAllowed,
  scenarioQuotas,
  type KaitenFetchMockScenario,
  type QuotaFixture,
} from "../../../.storybook/kaiten-mock.tsx";
import { LicenseUsage } from "./license-usage.tsx";

/**
 * The licence of a customer read with `mode="authenticated"`: the licence itself, so the block is
 * named by it, says its type when it is a trial and says its term. The entitlements reach the block
 * through the client's own normalizer (see `scenarioQuotas`), and the unit of a quota is the one its
 * definition carries, which a customer session's portal does not send.
 */

const THIS_MONTH: [string, string] = ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"];

/**
 * A licence of these quotas, named. Its term is the instance's, which `baseInstance()` makes a
 * running one that never lapses, so the plays below never depend on today's date.
 */
function licence(
  quotas: QuotaFixture[],
  options: { type?: "PAID" | "TRIAL"; usageUnavailable?: boolean } = {},
): KaitenFetchMockScenario {
  const scenario = scenarioQuotas(quotas, { usageUnavailable: options.usageUnavailable });
  return {
    ...scenario,
    license: baseLicense({ name: "Kaiten Enterprise", type: options.type ?? "PAID" }),
  };
}

// Module constants, not built inside the decorator: a fresh scenario object on every render busts
// `createStoryClient`'s memo and refetches the whole snapshot.
const kaitenLicence = licence([
  { slug: "seats", name: "Seats", limit: -1, used: 12, unit: ["seat", "seats"] },
  { slug: "instances", name: "Instances", limit: -1, used: 4, unit: ["instance", "instances"] },
  { slug: "customers", name: "Customers", limit: -1, used: 187, unit: ["customer", "customers"] },
  { slug: "webhooks", name: "Webhooks", limit: -1, used: 1, unit: ["webhook", "webhooks"] },
]);

const mixed = licence([
  {
    slug: "api_calls",
    name: "API calls",
    limit: 200_000,
    used: 30_000,
    allowancePercent: 20,
    unit: ["call", "calls"],
    window: THIS_MONTH,
  },
  { slug: "seats", name: "Seats", limit: 25, used: 5, unit: ["seat", "seats"] },
  { slug: "storage", name: "Storage", limit: 100, used: 62, unit: ["GB", "GB"] },
  { slug: "webhooks", name: "Webhooks", limit: -1, used: 6, unit: ["webhook", "webhooks"] },
]);

const trial = licence(
  [
    { slug: "seats", name: "Seats", limit: 5, used: 2, unit: ["seat", "seats"] },
    { slug: "webhooks", name: "Webhooks", limit: -1, used: 3, unit: ["webhook", "webhooks"] },
  ],
  { type: "TRIAL" },
);

const nearLimit = licence([
  { slug: "api_calls", name: "API calls", limit: 10_000, used: 8_500, unit: ["call", "calls"] },
  { slug: "seats", name: "Seats", limit: 25, used: 5, unit: ["seat", "seats"] },
]);

const pastTheGrant = licence([
  { slug: "api_calls", name: "API calls", limit: 100, used: 110, allowancePercent: 20 },
  { slug: "projects", name: "Projects", limit: 100, used: 120, allowancePercent: 20 },
  { slug: "storage", name: "Storage", limit: 100, used: 130, allowancePercent: 20 },
]);

const unreadable = licence(
  [
    { slug: "api_calls", name: "API calls", limit: 100, used: 100 },
    { slug: "seats", name: "Seats", limit: -1, used: 12 },
  ],
  { usageUnavailable: true },
);

/** A licence of features and no quantity: a boolean grant is not a quota. */
const noQuota: KaitenFetchMockScenario = {
  ...scenarioGateAllowed(),
  license: baseLicense({ name: "Kaiten Enterprise" }),
};

/**
 * Every story carries its OWN provider and `meta` carries none: a nested `<KaitenProvider>` with an
 * identical config is a no-op, so a story that wrapped itself in a second provider to swap the
 * scenario would silently keep `meta`'s.
 */
function shell(
  scenario: KaitenFetchMockScenario,
  options: Omit<React.ComponentProps<typeof KaitenStoryProvider>, "scenario" | "children"> = {},
) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <KaitenStoryProvider scenario={scenario} {...options}>
        <Story />
      </KaitenStoryProvider>
    );
  };
}

const meta: Meta<typeof LicenseUsage> = {
  title: "Flows/LicenseUsage",
  component: LicenseUsage,
};

export default meta;

type Story = StoryObj<typeof meta>;

const rowOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.getByText(name).closest('[data-slot="license-usage-quota"]') as HTMLElement;

/** The bar of a capped quota, by the name it is announced under: "API calls: 120 / 1,000". */
const barOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.findByRole("progressbar", { name: new RegExp(`^${name}:`) });

/**
 * A Kaiten licence, as Kaiten sells them today: every quota unlimited, each said with the unit its
 * definition gives it. A meter needs a cap to fill, so `UsageMeters` draws nothing for it; this draws
 * what the organization has used, out of "Unlimited".
 */
export const KaitenLicence: Story = {
  name: "A Kaiten licence: every quota unlimited",
  decorators: [shell(kaitenLicence)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" }),
    ).toBeInTheDocument();
    await expect(canvas.getByText("12 seats / Unlimited")).toBeInTheDocument();
    // The unit follows the count: one webhook, and 187 customers.
    await expect(canvas.getByText("1 webhook / Unlimited")).toBeInTheDocument();
    await expect(canvas.getByText("187 customers / Unlimited")).toBeInTheDocument();
    await expect(canvas.getAllByText(/ \/ Unlimited$/)).toHaveLength(4);
    await expect(canvas.queryAllByRole("progressbar")).toHaveLength(0);
    await expect(canvas.queryByText(/%/)).toBeNull();
    // The licence's term, as the licence says it.
    await expect(canvasElement.querySelector('[data-slot="license-usage-term"]')).toHaveTextContent(
      /^Renews /,
    );
  },
};

/**
 * Capped and unlimited quotas in one block: a soft limit with its hatched allowance and the window it
 * is counted in, a hard one, a lifetime counter and an unlimited one, in the order the client sorts
 * them.
 */
export const MixedCappedAndUnlimited: Story = {
  name: "Capped and unlimited quotas",
  decorators: [shell(mixed)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const calls = await barOf(canvas, "API calls");
    await expect(calls).toHaveAttribute("aria-valuemax", "240000");
    await expect(calls.querySelector('[data-segment="band"]')).not.toBeNull();
    await expect(
      within(rowOf(canvas, "API calls")).getByText(/^This period: /),
    ).toBeInTheDocument();
    await expect(within(rowOf(canvas, "API calls")).getByText("15%")).toBeInTheDocument();
    await expect(await barOf(canvas, "Storage")).toHaveAttribute("data-usage-state", "watch");
    await expect(within(rowOf(canvas, "Storage")).getByText("All time")).toBeInTheDocument();
    await expect(
      within(rowOf(canvas, "Webhooks")).getByText("6 webhooks / Unlimited"),
    ).toBeInTheDocument();
  },
};

/** A licence that is a trial wears the badge, beside its name. */
export const InATrial: Story = {
  name: "In a trial",
  decorators: [shell(trial)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
    await expect(
      canvasElement.querySelector('[data-slot="license-usage-trial"]'),
    ).toHaveTextContent("Trial");
  },
};

/** From 80% of what the API accepts a quota is amber, and its percentage says how much was granted. */
export const NearLimit: Story = {
  name: "A quota near its limit",
  decorators: [shell(nearLimit)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "near_limit",
    );
    await expect(within(rowOf(canvas, "API calls")).getByText("85%")).toBeInTheDocument();
    await expect(await barOf(canvas, "Seats")).toHaveAttribute("data-usage-state", "healthy");
  },
};

/**
 * Past the grant, each of the three ways that call for a look: inside the allowance (served, so
 * amber), on the ceiling (the last usage the API accepts, so red) and past it (red).
 */
export const PastTheGrant: Story = {
  name: "Past the grant, with a soft limit",
  decorators: [shell(pastTheGrant)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "in_allowance",
    );
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "at_limit");
    await expect(await barOf(canvas, "Storage")).toHaveAttribute("data-usage-state", "over_limit");
    // The bar's track runs to the ceiling, 120, and a tick marks the grant.
    const calls = await barOf(canvas, "API calls");
    await expect(calls).toHaveAttribute("aria-valuemax", "120");
    await expect(calls.querySelector('[data-segment="grant"]')).not.toBeNull();
  },
};

/**
 * The usage read failed: what was consumed is unknown, which is not zero. Every row says so in place
 * of "0 / 100", a percentage and a bar; the grant that is unlimited is still known to be.
 */
export const UsageUnavailable: Story = {
  name: "A usage read that failed",
  decorators: [shell(unreadable)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
    await expect(canvas.getByText("Usage unavailable")).toBeInTheDocument();
    await expect(canvas.queryAllByRole("progressbar")).toHaveLength(0);
    await expect(canvas.queryByText(/^0 \/ /)).toBeNull();
    await expect(canvas.queryByText(/%/)).toBeNull();
    await expect(
      within(rowOf(canvas, "Seats")).getByText("Usage unavailable / Unlimited"),
    ).toBeInTheDocument();
  },
};

/** The snapshot has not answered. */
export const Loading: Story = {
  decorators: [shell(mixed, { simulateLoading: 60_000 })],
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector('[data-slot="license-usage-loading"]'),
    ).toHaveAttribute("aria-busy", "true");
    await expect(canvasElement.querySelector('[data-slot="license-usage"]')).toBeNull();
  },
};

/** The snapshot failed: an error with a way to ask again, never an empty page. */
export const Failed: Story = {
  name: "The snapshot cannot be read",
  decorators: [shell(mixed, { simulateError: true })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Failed to load");
    await expect(canvas.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  },
};

/** A licence of features and no quantity says there is nothing to measure. */
export const NothingToMeasure: Story = {
  name: "A licence with no numeric quota",
  decorators: [shell(noQuota)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
    await expect(canvas.getByText("No metered quota on this plan.")).toBeInTheDocument();
    await expect(canvas.queryByRole("list")).toBeNull();
  },
};

export const Dark: Story = {
  decorators: [shell(mixed)],
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toBeInTheDocument();
    await expect(
      within(rowOf(canvas, "Webhooks")).getByText("6 webhooks / Unlimited"),
    ).toBeInTheDocument();
  },
};

/** The same in the dark theme with the amber and red states: they must read on a dark surface. */
export const PastTheGrantDark: Story = {
  name: "Past the grant, in the dark theme",
  decorators: [shell(pastTheGrant)],
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "Storage")).toHaveAttribute("data-usage-state", "over_limit");
  },
};

/** No class and no card: the markup is the SDK's, the look is the host's. */
export const Unstyled: Story = {
  decorators: [shell(mixed)],
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
    await expect(canvas.getByText(/^API calls: 30,000 \/ 200,000 calls/)).toBeInTheDocument();
    await expect(canvas.getByText(/^Webhooks: 6 webhooks \/ Unlimited/)).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).toBeNull();
    await expect(canvasElement.querySelector('[data-slot="card"]')).toBeNull();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [shell(trial, { locale: fr })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
    await expect(
      canvasElement.querySelector('[data-slot="license-usage-trial"]'),
    ).toHaveTextContent("Essai");
    await expect(canvasElement.querySelector('[data-slot="license-usage-term"]')).toHaveTextContent(
      /^Renouvellement le /,
    );
    await expect(within(rowOf(canvas, "Webhooks")).getByText(/ \/ Illimité$/)).toBeInTheDocument();
  },
};
