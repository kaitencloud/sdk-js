// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect, within } from "storybook/test";

import {
  KaitenStoryProvider,
  scenarioGateAllowed,
  scenarioGateDenied,
  scenarioPaywallFlagDisabled,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { KaitenFailed, KaitenLoaded, KaitenLoading, Show } from "@kaitencloud/react";

const portalScenario = scenarioPortalDefault();
const allowedScenario = scenarioGateAllowed();
const deniedScenario = scenarioGateDenied();
const flagDisabledScenario = scenarioPaywallFlagDisabled();

const Surface = ({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "muted" | "destructive";
}) => (
  <div
    className={
      tone === "destructive"
        ? "rounded-md border border-destructive-subtle-foreground/30 bg-destructive-subtle p-4 text-sm text-destructive-subtle-foreground"
        : tone === "muted"
          ? "rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground"
          : "rounded-md border border-border bg-secondary/50 p-4 text-sm"
    }
  >
    {children}
  </div>
);

const meta: Meta = {
  title: "Elements/Control",
  parameters: {
    docs: {
      description: {
        component:
          "`KaitenLoaded`, `KaitenLoading`, and `KaitenFailed` mirror the lifecycle of the `KaitenProvider` data. `Show` declaratively gates content on entitlements or feature flags.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Lifecycle: Story = {
  name: "Lifecycle (Loaded / Loading / Failed)",
  parameters: {
    docs: {
      description: {
        story:
          "Side-by-side preview of all three lifecycle gates. The first column is loaded, the second simulates a long-running fetch, the third forces an HTTP 500 error.",
      },
    },
  },
  render: () => (
    <div className="grid w-full max-w-5xl gap-4 md:grid-cols-3">
      <KaitenStoryProvider scenario={portalScenario}>
        <KaitenLoading>
          <Surface tone="muted">KaitenLoading children — should not appear once loaded.</Surface>
        </KaitenLoading>
        <KaitenLoaded>
          <Surface>KaitenLoaded children — provider data is ready.</Surface>
        </KaitenLoaded>
        <KaitenFailed>
          <Surface tone="destructive">
            KaitenFailed children — should not appear when healthy.
          </Surface>
        </KaitenFailed>
      </KaitenStoryProvider>

      <KaitenStoryProvider scenario={portalScenario} simulateLoading={10000}>
        <KaitenLoading>
          <div className="space-y-2 rounded-md border border-border p-4" aria-busy="true">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </KaitenLoading>
        <KaitenLoaded>
          <Surface>This stays hidden for ~10s while loading.</Surface>
        </KaitenLoaded>
        <KaitenFailed>
          <Surface tone="destructive">Hidden during a slow fetch.</Surface>
        </KaitenFailed>
      </KaitenStoryProvider>

      <KaitenStoryProvider scenario={portalScenario} simulateError>
        <KaitenLoading>
          <Surface tone="muted">Hidden when the fetch already errored.</Surface>
        </KaitenLoading>
        <KaitenLoaded>
          <Surface>Hidden when the fetch failed.</Surface>
        </KaitenLoaded>
        <KaitenFailed>
          <Surface tone="destructive">
            KaitenFailed children — render an inline error banner here.
          </Surface>
        </KaitenFailed>
      </KaitenStoryProvider>
    </div>
  ),
};

export const Loaded: Story = {
  name: "KaitenLoaded",
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={portalScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <KaitenLoaded>
      <Surface>Provider data loaded — wrap your protected app shell here.</Surface>
    </KaitenLoaded>
  ),
};

export const Loading: Story = {
  name: "KaitenLoading",
  parameters: {
    docs: {
      description: {
        story:
          "The mock fetch is delayed for ~10s so the `KaitenLoading` skeleton stays visible long enough to inspect.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={portalScenario} simulateLoading={10000}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <KaitenLoading>
      <div
        className="w-full max-w-md space-y-2 rounded-md border border-border p-4"
        aria-busy="true"
      >
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </KaitenLoading>
  ),
};

export const Failed: Story = {
  name: "KaitenFailed",
  parameters: {
    docs: {
      description: {
        story:
          "The mock returns HTTP 500 for snapshot/catalog endpoints, exercising the `KaitenFailed` branch.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={portalScenario} simulateError>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <KaitenFailed>
      <Surface tone="destructive">
        Could not load licensing data. Render a retry button or inline error here.
      </Surface>
    </KaitenFailed>
  ),
};

export const ShowEntitled: Story = {
  name: 'Show — when="entitled"',
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={allowedScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="entitled"
      entitlement="premium"
      fallback={<Surface tone="destructive">Fallback — premium not available.</Surface>}
    >
      <Surface>Premium feature unlocked for this license.</Surface>
    </Show>
  ),
  // Every `Show` story below waits for the branch it means to demonstrate.
  //
  // `Show` renders `null` while the check is in flight and, with the default
  // `onError="block"`, renders `fallback` when the request fails — so without a
  // wait, a story can be captured empty or showing the opposite branch, and
  // nothing says so. That is not hypothetical: CI once measured this file's
  // `Dark` story on its fallback and reported a contrast violation for markup the
  // story does not intend to show, while the same run passed locally on the
  // entitled branch.
  //
  // The a11y check runs after `play`, so waiting here is also what makes the
  // accessibility coverage deterministic. A broken mock now fails on this line
  // instead of silently swapping what gets audited.
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/Premium feature unlocked/);
  },
};

export const ShowNotEntitled: Story = {
  name: 'Show — when="not-entitled"',
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={deniedScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="not-entitled"
      entitlement="premium"
      fallback={<Surface tone="muted">Fallback — premium is enabled (this is hidden).</Surface>}
    >
      <Surface tone="destructive">
        Premium is locked — render an upsell here when the user is <em>not</em> entitled.
      </Surface>
    </Show>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/Premium is locked/);
  },
};

export const ShowFlagEnabled: Story = {
  name: 'Show — when="flag-enabled"',
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={portalScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="flag-enabled"
      flagKey="premium-feature"
      fallback={<Surface tone="muted">Fallback — flag is disabled.</Surface>}
    >
      <Surface>The `premium-feature` flag is on for this user.</Surface>
    </Show>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/flag is on for this user/);
  },
};

export const ShowFlagDisabled: Story = {
  name: 'Show — when="flag-disabled"',
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={flagDisabledScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="flag-disabled"
      flagKey="premium-feature"
      fallback={<Surface tone="muted">Fallback — flag is enabled (this is hidden).</Surface>}
    >
      <Surface tone="destructive">
        The `premium-feature` flag is off — show a disabled state or kill switch.
      </Surface>
    </Show>
  ),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText(/flag is off/);
  },
};

export const ShowWithLoading: Story = {
  name: "Show — loading slot",
  parameters: {
    docs: {
      description: {
        story:
          "While the entitlement check is in-flight, `Show` renders the `loading` slot. The mock fetch is delayed for ~10s.",
      },
    },
  },
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={allowedScenario} simulateLoading={10000}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="entitled"
      entitlement="premium"
      loading={
        <div className="w-full max-w-md space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      }
      fallback={<Surface tone="destructive">Fallback — entitlement denied.</Surface>}
    >
      <Surface>Resolved content (visible once entitlements load).</Surface>
    </Show>
  ),
  // The inverse wait: this story exists to show the loading slot, so it asserts the
  // skeleton is still up. If the simulated delay ever stops working, the story would
  // otherwise quietly start demonstrating resolved content instead.
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[aria-busy="true"]')).toBeInTheDocument();
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
      <KaitenStoryProvider scenario={allowedScenario}>
        <Story />
      </KaitenStoryProvider>
    ),
  ],
  render: () => (
    <Show
      when="entitled"
      entitlement="premium"
      fallback={<Surface tone="destructive">Hidden in this story.</Surface>}
    >
      <Surface>Show / Loaded in dark theme.</Surface>
    </Show>
  ),
  // The story CI caught out: it audited the destructive fallback here and flagged its
  // contrast, while the same commit passed locally on the entitled branch.
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText("Show / Loaded in dark theme.");
  },
};
