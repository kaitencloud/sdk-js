// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { fr } from "@kaitencloud/react/locales";

import {
  KaitenStoryProvider,
  scenarioQuotas,
  type KaitenFetchMockScenario,
} from "../../../.storybook/kaiten-mock.tsx";
import { UsageMeters } from "./customer-portal.tsx";

// The usage read failed: the grants are known, what is consumed is not. Built once, not in the
// decorator: a fresh scenario object on every render refetches the whole snapshot.
const unreadable = scenarioQuotas(
  [
    { slug: "api_calls", name: "API calls", limit: 10_000, used: 4_200 },
    { slug: "seats", name: "Seats", limit: 25, used: 12 },
  ],
  { usageUnavailable: true },
);

/** Every story carries its OWN provider, and `meta` carries none: a nested one is a no-op. */
function shell(scenario: KaitenFetchMockScenario, locale?: typeof fr) {
  return function Decorator(Story: () => React.JSX.Element) {
    return (
      <KaitenStoryProvider scenario={scenario} locale={locale}>
        <div className="w-full max-w-md">
          <Story />
        </div>
      </KaitenStoryProvider>
    );
  };
}

/**
 * The usage meters of a customer portal, alone. A usage read that failed says nothing about how
 * much is used, which is not "nothing used": the section says so in place of "0 / 10,000", "0%"
 * and a bar of nothing. Under a customer session the same happens one quota at a time (see "Flows/
 * Customer portal (session)").
 */
const meta: Meta<typeof UsageMeters> = {
  title: "Elements/UsageMeters",
  component: UsageMeters,
};

export default meta;

type Story = StoryObj<typeof meta>;

export const UsageUnavailable: Story = {
  decorators: [shell(unreadable)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls");
    await expect(
      canvasElement.querySelectorAll('[data-slot="usage-meters-unavailable"]'),
    ).toHaveLength(2);
    await expect(canvas.getAllByText("Usage unavailable")).toHaveLength(2);
    await expect(canvas.queryAllByRole("progressbar")).toHaveLength(0);
    await expect(canvas.queryByText(/^0 \//)).toBeNull();
    await expect(canvas.queryByText("0%")).toBeNull();
  },
};

export const UsageUnavailableUnstyled: Story = {
  decorators: [shell(unreadable)],
  args: { unstyled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/^API calls:/)).toHaveTextContent(
      "API calls: Usage unavailable",
    );
    await expect(canvas.queryByText(/0 \/ 10000/)).toBeNull();
  },
};

export const UsageUnavailableInFrench: Story = {
  name: "Usage unavailable, in French",
  decorators: [shell(unreadable, fr)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("API calls");
    await expect(canvas.getAllByText("Consommation indisponible")).toHaveLength(2);
  },
};
