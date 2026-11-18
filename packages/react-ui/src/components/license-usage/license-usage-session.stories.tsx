// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import {
  apiCallsUsed,
  kaitenLicense,
  pastTheGrant,
  seatsUnmeasured,
} from "../../../.storybook/license-portals.ts";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { trialPortal } from "../../../.storybook/session-server.ts";
import { LicenseUsage } from "./license-usage.tsx";

/**
 * The licence of a customer session, which is what the Kaiten console shows an organization of its
 * own Kaiten licence: read through the real session client, from what Kaiten answered for Initech
 * (`.storybook/portal-mock.tsx`) or from that answer with its entitlements changed
 * (`.storybook/license-portals.ts`, held to the API contract by `tests/license-usage-portals.test.ts`).
 * A session has no licence, so the block is named by the plan the portal names and draws no term.
 *
 * Every story carries its own provider, built once for it: a story is a customer in one situation.
 */
const meta: Meta<typeof LicenseUsage> = {
  title: "Flows/LicenseUsage (session)",
  component: LicenseUsage,
  decorators: [portalDecorator()],
};

export default meta;

type Story = StoryObj<typeof meta>;

const SLOW = { timeout: 5_000 };

const rowOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.getByText(name).closest('[data-slot="license-usage-quota"]') as HTMLElement;

/** The bar of a capped quota, by the name it is announced under: "API calls: 120 / 1,000". */
const barOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.findByRole("progressbar", { name: new RegExp(`^${name}:`) }, SLOW);

/**
 * A Kaiten licence, as Kaiten sells them today: every quota unlimited. A meter needs a cap to fill,
 * so `UsageMeters` draws nothing for it; this draws what the organization has used, out of
 * "Unlimited".
 */
export const KaitenLicence: Story = {
  name: "A Kaiten licence: every quota unlimited",
  decorators: [portalDecorator({ portal: kaitenLicense() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" }, SLOW),
    ).toBeInTheDocument();
    for (const [name, used] of [
      ["Customers", "187"],
      ["Instances", "4"],
      ["Seats", "12"],
      ["Webhooks", "6"],
    ] as const) {
      const row = within(rowOf(canvas, name));
      await expect(row.getByText(`${used} / Unlimited`)).toBeInTheDocument();
      await expect(row.queryByRole("progressbar")).toBeNull();
    }
    // No term: a customer session's portal carries none.
    await expect(canvasElement.querySelector('[data-slot="license-usage-term"]')).toBeNull();
  },
};

/**
 * The portal recorded for Initech: capped quotas with their bars, one of them a soft limit a voucher
 * doubled (with the note that says so), a quota that is unlimited, and three grants that are not
 * quotas and are `IncludedFeatures`' to list.
 */
export const MixedCappedAndUnlimited: Story = {
  name: "Capped and unlimited quotas",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Pro" }, SLOW),
    ).toBeInTheDocument();
    // 30,000 of 200,000, on a track that runs to the ceiling the 20% allowance leaves: 240,000.
    const calls = await barOf(canvas, "API calls");
    await expect(calls).toHaveAttribute("data-usage-state", "healthy");
    await expect(calls).toHaveAttribute("aria-valuemax", "240000");
    await expect(calls.querySelector('[data-segment="band"]')).not.toBeNull();
    await expect(await barOf(canvas, "Seats")).toHaveAttribute("data-usage-state", "at_limit");
    const workspaces = within(rowOf(canvas, "Workspaces"));
    await expect(workspaces.getByText("12 / Unlimited")).toBeInTheDocument();
    await expect(canvas.queryByText("Single sign-on")).toBeNull();
    await expect(canvas.queryByText("Branding")).toBeNull();
    await userEvent.click(
      canvas.getByRole("button", { name: "How this limit is made up: API calls" }),
    );
    await expect(canvas.getByRole("note")).toHaveTextContent(
      "Source: Current plan. (100,000 base) × 2 voucher = 200,000",
    );
  },
};

/** From 80% of what the API accepts a quota is amber: 192,000 of a ceiling of 240,000. */
export const NearLimit: Story = {
  name: "A quota near its limit",
  decorators: [portalDecorator({ portal: apiCallsUsed(192_000) })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "near_limit",
    );
    // The percentage is of what was granted, not of the ceiling.
    await expect(within(rowOf(canvas, "API calls")).getByText("96%")).toBeInTheDocument();
  },
};

/**
 * Past the grant, each of the three ways that call for a look: inside the allowance (served, so
 * amber, and 110% of the grant is the truth), on the ceiling (the last usage the API accepts) and
 * past it (as when a limit was lowered under what was consumed). The last two are red.
 */
export const PastTheGrant: Story = {
  name: "Past the grant, with a soft limit",
  decorators: [portalDecorator({ portal: pastTheGrant() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await barOf(canvas, "API calls")).toHaveAttribute(
      "data-usage-state",
      "in_allowance",
    );
    await expect(await barOf(canvas, "Projects")).toHaveAttribute("data-usage-state", "at_limit");
    await expect(await barOf(canvas, "Storage")).toHaveAttribute("data-usage-state", "over_limit");
    await expect(within(rowOf(canvas, "API calls")).getByText("110%")).toBeInTheDocument();
    await expect(within(rowOf(canvas, "Storage")).getByText("130%")).toBeInTheDocument();
  },
};

/**
 * A session reports a quota whose usage could not be measured as a number with no usage. The row says
 * so in place of "0 / 8", a percentage and a bar, and the others are drawn as they are.
 */
export const UsageUnavailable: Story = {
  name: "A quota whose usage could not be read",
  decorators: [portalDecorator({ portal: seatsUnmeasured() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Seats", {}, SLOW);
    const seats = within(rowOf(canvas, "Seats"));
    await expect(seats.getByText("Usage unavailable")).toBeInTheDocument();
    await expect(seats.queryByRole("progressbar")).toBeNull();
    await expect(seats.queryByText(/%/)).toBeNull();
    await expect(seats.queryByText(/^0 \/ /)).toBeNull();
    // The AI credits really are unused, and say so: 0 of 100 is what a measured zero reads like.
    await expect(within(rowOf(canvas, "AI credits")).getByText("0 / 100")).toBeInTheDocument();
    await expect(await barOf(canvas, "API calls")).toBeInTheDocument();
  },
};

/** The first read of the portal has not answered. */
export const Loading: Story = {
  decorators: [portalDecorator({ portal: kaitenLicense(), delayMs: 60_000 })],
  play: async ({ canvasElement }) => {
    const loading = canvasElement.querySelector('[data-slot="license-usage-loading"]');
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(canvasElement.querySelector('[data-slot="license-usage"]')).toBeNull();
  },
};

/**
 * A Kaiten that does not serve the portal answers 404. The block says so with a way to ask again,
 * never an empty page, which would read as a licence with no quotas.
 */
export const Failed: Story = {
  name: "The portal cannot be read",
  decorators: [
    portalDecorator({
      portal: kaitenLicense(),
      scripts: {
        "GET portal": [
          { status: 404, body: { title: "Not Found", status: 404, detail: "portal" } },
        ],
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("alert", {}, SLOW)).toHaveTextContent("Failed to load");
    await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
    // Only the first read was refused: asking again recovers.
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Kaiten Enterprise" }, SLOW),
    ).toBeInTheDocument();
  },
};

/**
 * A plan that grants no quota at all (Starter grants single sign-on, which is a feature and not a
 * quantity): the block names the plan and says there is nothing to measure.
 */
export const NothingToMeasure: Story = {
  name: "A plan with no numeric quota",
  decorators: [portalDecorator({ portal: "portalNeverSubscribed" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Starter" }, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByText("No metered quota on this plan.")).toBeInTheDocument();
    await expect(canvas.queryByRole("list")).toBeNull();
  },
};

/** A session bound to the customer only has no instance, so no plan to name and no quota. */
export const Unbound: Story = {
  name: "A session bound to the customer only",
  decorators: [portalDecorator({ portal: "portalCustomerWide" })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Usage meters" }, SLOW),
    ).toBeInTheDocument();
    await expect(canvas.getByText("No metered quota on this plan.")).toBeInTheDocument();
  },
};

/** The subscription is in its trial: the block says so with a badge, beside the plan's name. */
export const InATrial: Story = {
  name: "In a trial",
  decorators: [portalDecorator({ portal: trialPortal() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Pro" }, SLOW);
    await expect(
      canvasElement.querySelector('[data-slot="license-usage-trial"]'),
    ).toHaveTextContent("Trial");
  },
};

export const Dark: Story = {
  parameters: { themes: { themeOverride: "dark" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await barOf(canvas, "API calls");
    await expect(
      within(rowOf(canvas, "Workspaces")).getByText("12 / Unlimited"),
    ).toBeInTheDocument();
  },
};

/** No class and no card: the markup is the SDK's, the look is the host's. */
export const Unstyled: Story = {
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Pro" }, SLOW);
    await expect(canvas.getByText(/^API calls: 30,000 \/ 200,000/)).toBeInTheDocument();
    await expect(canvas.getByText(/^Workspaces: 12 \/ Unlimited/)).toBeInTheDocument();
    await expect(canvas.queryByRole("progressbar")).toBeNull();
    await expect(canvasElement.querySelector('[data-slot="card"]')).toBeNull();
  },
};

export const InFrench: Story = {
  name: "In French",
  decorators: [portalDecorator({ portal: trialPortal() }, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("heading", { level: 2, name: "Pro" }, SLOW);
    await expect(
      canvasElement.querySelector('[data-slot="license-usage-trial"]'),
    ).toHaveTextContent("Essai");
    await expect(
      within(rowOf(canvas, "Workspaces")).getByText("12 / Illimité"),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("list", { name: "Usage" })).toBeInTheDocument();
  },
};
