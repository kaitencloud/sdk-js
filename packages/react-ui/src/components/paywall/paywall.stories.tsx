// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { StrictMode, type ReactNode } from "react";
import { action } from "storybook/actions";
import { expect, userEvent, within } from "storybook/test";

import {
  KaitenStoryProvider,
  scenarioPaywallFlagDisabled,
  scenarioPaywallNearLimit,
  scenarioPaywallOk,
  scenarioPaywallOverLimit,
} from "../../../.storybook/kaiten-mock.tsx";
import { Paywall } from "./paywall.tsx";

const nearScenario = scenarioPaywallNearLimit();
const overScenario = scenarioPaywallOverLimit();
const okScenario = scenarioPaywallOk();
const flagDisabledScenario = scenarioPaywallFlagDisabled();

const shell = (node: ReactNode) => (
  <div className="relative min-h-[280px] w-full max-w-xl rounded-lg border border-dashed border-border p-4">
    {node}
  </div>
);

/**
 * Stand-in for the host's gated feature, sized like one.
 *
 * The soft wall is an `absolute inset-0` overlay, so the box the card has to fit into
 * is the box it is handed. These stories are about the full card, so they gate a block
 * that can hold it — `min-h-80` clears its ~253px plus the frame's padding, and the
 * explicit width keeps the story off Storybook's shrink-to-fit canvas. Gating something
 * smaller is `SoftSmallArea`, where the wall drops to its compact row instead.
 */
/*
 * `w-full max-w-[32rem]`, not a flat `w-[32rem]`.
 *
 * This is HOST markup — `Paywall` renders whatever it is given and must not resize it,
 * so a fixed 512px block stayed 512px wide in a 320px slot and the layout suite duly
 * recorded a 209px overflow against the paywall. The number was real and the component
 * was not at fault: the fixture was describing a host that hands a 320px slot a block
 * half again as wide as the slot, which no host does.
 *
 * Capped rather than freed so the widest rendering is unchanged — at the story canvas
 * it still resolves to 512px, and the visual baseline with it. Whether the WALL fits a
 * box smaller than its own card is a different question, and `SoftSmallArea` below is
 * the story that asks it.
 */
const gatedBlock = (label: string) => (
  <div className="flex min-h-80 w-full max-w-[32rem] flex-col gap-3 rounded-lg border border-border p-4">
    <p className="text-sm font-medium">{label}</p>
    <div className="flex flex-1 items-end gap-2" aria-hidden="true">
      {[38, 62, 45, 80, 54, 71, 49, 66].map((height, index) => (
        <div
          className="flex-1 rounded-t-sm bg-primary/70"
          key={index}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  </div>
);

const meta: Meta<typeof Paywall> = {
  title: "Flows/Paywall",
  component: Paywall,
  args: {
    onUpgrade: action("onUpgrade"),
    onDismiss: action("onDismiss"),
    onThresholdReached: action("onThresholdReached"),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const SoftVsHardDocs: Story = {
  name: "Soft vs hard (read me)",
  parameters: {
    docs: {
      description: {
        story:
          "**Soft** blurs content and allows dismiss. **Hard** uses a blocking dialog for over-limit or flag-disabled. Compare `SoftNearLimit` with `HardOverLimit` or `HardFlagDisabled`.",
      },
    },
  },
  render: () => (
    <p className="text-sm text-muted-foreground">
      Open <strong>SoftNearLimit</strong> and <strong>HardOverLimit</strong> in the sidebar to
      compare modes side by side.
    </p>
  ),
};

export const SoftNearLimit: Story = {
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={nearScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    children: gatedBlock("API usage this month"),
  },
};

export const SoftSmallArea: Story = {
  name: "Soft — small gated area",
  parameters: {
    docs: {
      description: {
        story:
          "A host gates small things: a button, a toolbar row, a single stat. The wall is an " +
          "`absolute inset-0` overlay, so that is all the room the card gets — a ~20px box for " +
          "a ~253px card, which used to spill over whatever sat above and below it. Below the " +
          "full card's footprint the wall collapses to a single row, and the wrapper carries a " +
          "floor so that row fits. The play function asserts the card stays inside the wall.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={nearScenario}>
        <div className="flex w-[32rem] flex-col gap-3 rounded-lg border border-dashed border-border p-4">
          <p className="text-sm text-muted-foreground">Content above the gated row.</p>
          <Story />
          <p className="text-sm text-muted-foreground">Content below the gated row.</p>
        </div>
      </KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    children: (
      <button
        type="button"
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
      >
        Export CSV
      </button>
    ),
  },
  play: async ({ canvasElement }) => {
    const wall = canvasElement.querySelector('[data-slot="paywall"]');
    const card = canvasElement.querySelector('[data-slot="card"]');
    const panel = canvasElement.querySelector<HTMLElement>('[data-slot="paywall"] [role="group"]');
    await expect(wall).not.toBeNull();
    await expect(card).not.toBeNull();
    await expect(panel).not.toBeNull();

    // The invariant the compact wall exists for: whatever the host gated, the card
    // stays inside the box the wall covers, so it never lands on the content either
    // side of it — where the backdrop blur does not reach.
    const wallBox = wall!.getBoundingClientRect();
    const cardBox = card!.getBoundingClientRect();
    await expect(cardBox.height).toBeLessThanOrEqual(wallBox.height);
    await expect(cardBox.top).toBeGreaterThanOrEqual(wallBox.top);
    await expect(cardBox.bottom).toBeLessThanOrEqual(wallBox.bottom);
    await expect(cardBox.left).toBeGreaterThanOrEqual(wallBox.left);
    await expect(cardBox.right).toBeLessThanOrEqual(wallBox.right);

    // The meter and the usage line leave the row visually, not the wall: they are
    // visually hidden rather than `display: none`, so a screen reader still gets them.
    const panelContent = within(panel!);
    await expect(panelContent.getByRole("progressbar")).toBeInTheDocument();

    // Both actions survive the collapse — the row is smaller, not emptier.
    const actions = panelContent.getAllByRole("button");
    await expect(actions).toHaveLength(2);
    for (const button of actions) await expect(button).toBeVisible();
  },
};

export const HardOverLimit: Story = {
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={overScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "hard",
    children: <p className="text-sm">Content is replaced when over limit in hard mode.</p>,
  },
};

export const HardOverLimitStrictMode: Story = {
  name: "Hard over limit, under StrictMode",
  // StrictMode runs the dialog's effect, its cleanup, then the effect again: the wall must stay up
  // through that, as it does in a host's development build.
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={overScenario}>
        <StrictMode>{shell(<Story />)}</StrictMode>
      </KaitenStoryProvider>
    ),
  ],
  args: HardOverLimit.args,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await canvas.findByRole("dialog", {}, { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(canvas.getByRole("dialog")).toBe(dialog);
    await expect((dialog as HTMLDialogElement).open).toBe(true);
  },
};

export const NoOverlayUnderThreshold: Story = {
  decorators: [
    (Story) => <KaitenStoryProvider scenario={okScenario}>{shell(<Story />)}</KaitenStoryProvider>,
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    children: (
      <p className="text-sm text-muted-foreground">
        Usage is low — no paywall overlay (check should not appear).
      </p>
    ),
  },
};

export const HardFlagDisabled: Story = {
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={flagDisabledScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    flagKey: "premium-feature",
    mode: "hard",
    children: (
      <p className="text-sm">Content hidden when the feature flag is disabled (hard mode).</p>
    ),
  },
};

export const SoftNoActions: Story = {
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={overScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    onUpgrade: undefined,
    onDismiss: undefined,
    children: gatedBlock("No upgrade or dismiss action provided"),
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
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={overScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    unstyled: true,
    children: <p>Protected content</p>,
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={nearScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    children: gatedBlock("Soft paywall rendered in dark theme"),
  },
};

export const SoftDismissed: Story = {
  parameters: {
    docs: {
      description: {
        story:
          "Auto-clicks the **Dismiss** button to demonstrate the post-dismiss state — the soft paywall disappears and the underlying content is fully visible again.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={nearScenario}>{shell(<Story />)}</KaitenStoryProvider>
    ),
  ],
  args: {
    entitlement: "api_calls",
    threshold: 0.8,
    mode: "soft",
    children: gatedBlock("Fully visible again after dismiss"),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dismissButton = await canvas.findByRole("button", { name: /dismiss/i });
    await userEvent.click(dismissButton);
    await expect(canvas.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  },
};
