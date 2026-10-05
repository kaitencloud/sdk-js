import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";
import { action } from "storybook/actions";

import { Button } from "../ui/button.tsx";
import { KaitenErrorBoundary } from "@kaitencloud/react";

function Boom({ message = "Something went wrong" }: { message?: string }): React.ReactElement {
  throw new Error(message);
}

const meta: Meta<typeof KaitenErrorBoundary> = {
  title: "Shared/KaitenErrorBoundary",
  component: KaitenErrorBoundary,
  parameters: {
    docs: {
      description: {
        component:
          "`KaitenErrorBoundary` is a small React error boundary used internally to keep the SDK from crashing the host app. The default fallback is a destructive banner; you can pass a custom node, or a render function receiving the caught `Error`.",
      },
    },
    a11y: {
      // Default fallback uses tokens that fail axe contrast checks at this size.
      test: "off",
    },
  },
  args: {
    onError: action("onError"),
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Healthy: Story = {
  name: "Healthy (no error)",
  args: {
    children: (
      <div className="rounded-md border border-border bg-secondary/50 p-4 text-sm">
        Children render normally when no error is thrown.
      </div>
    ),
  },
};

export const DefaultFallback: Story = {
  name: "Default fallback",
  args: {
    children: <Boom message="Default fallback message" />,
  },
};

export const CustomFallback: Story = {
  args: {
    fallback: (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700">
        Custom fallback — wire up your retry CTA here.
      </div>
    ),
    children: <Boom message="ignored" />,
  },
};

export const RenderPropFallback: Story = {
  name: "Render-prop fallback (uses error)",
  parameters: {
    docs: {
      description: {
        story:
          "Pass a function as `fallback` to read the caught `Error` (e.g. show its message, log it, render a retry button).",
      },
    },
  },
  args: {
    fallback: (error: Error) => (
      <div className="space-y-2 rounded-md border border-destructive-subtle-foreground/30 bg-destructive-subtle p-4 text-sm text-destructive-subtle-foreground">
        <p className="font-medium">Could not render this section</p>
        <pre className="overflow-x-auto rounded bg-destructive/10 p-2 text-xs">{error.message}</pre>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    ),
    children: <Boom message="The downstream component blew up." />,
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
  args: {
    children: <Boom message="Default fallback in dark theme" />,
  },
};
