import type { Meta, StoryObj } from "@storybook/react-vite";
import * as React from "react";

import {
  STORYBOOK_API_BASE,
  baseCustomer,
  installKaitenFetchMock,
  KaitenStoryProvider,
  restoreKaitenFetchMock,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { KaitenProvider } from "@kaitencloud/react";
import { KaitenStyleRoot } from "../../style-root/kaiten-style-root.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { KaitenBranding } from "./kaiten-branding.tsx";

const brandingScenario = scenarioPortalDefault();

function HideBrandingProvider({
  removable,
  hide,
  children,
}: {
  removable: boolean;
  hide: boolean;
  children: React.ReactNode;
}) {
  const scenario = React.useMemo(
    () => ({ ...brandingScenario, branding: { removable } }),
    [removable],
  );
  installKaitenFetchMock(scenario);
  React.useEffect(() => () => restoreKaitenFetchMock(), []);
  return (
    <KaitenProvider
      mode="authenticated"
      apiUrl={STORYBOOK_API_BASE}
      accessToken="storybook-token"
      customerId={baseCustomer().id}
      instanceId={scenario.instance.id}
      hideBranding={hide}
      polling={{ enabled: false }}
    >
      <KaitenStyleRoot>{children}</KaitenStyleRoot>
    </KaitenProvider>
  );
}

const meta: Meta<typeof KaitenBranding> = {
  title: "Shared/KaitenBranding",
  component: KaitenBranding,
  decorators: [
    (Story) => (
      <KaitenStoryProvider scenario={brandingScenario}>
        <div className="w-full max-w-md">
          <Story />
        </div>
      </KaitenStoryProvider>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "`KaitenBranding` is the *Powered by Kaiten* attribution shown by built-in flows. It can be hidden via the `KaitenProvider` `hideBranding` prop **only** when the customer's plan allows it (`branding.removable === true`).",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Footer: Story = {
  name: "Footer (default)",
  args: {
    variant: "footer",
  },
};

export const InsideCardFooter: Story = {
  name: "Footer attached to a Card",
  parameters: {
    docs: {
      description: {
        story:
          "The `footer` variant is meant to be attached to a `CardFooter` with negative margins so it merges visually with the hosting card.",
      },
    },
  },
  render: () => (
    <Card>
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Pro license — 10,000 API calls included.
      </CardContent>
      <CardFooter className="-mx-6 -mb-6 flex-col p-0">
        <KaitenBranding />
      </CardFooter>
    </Card>
  ),
};

export const Card_: Story = {
  name: "Card variant",
  args: {
    variant: "card",
  },
  parameters: {
    docs: {
      description: {
        story:
          'Use `variant="card"` for multi-section layouts (e.g. CustomerPortal) where the branding lives outside any other card.',
      },
    },
  },
};

export const Unstyled: Story = {
  args: {
    unstyled: true,
  },
  parameters: {
    docs: {
      description: {
        story: "Headless mode — bring your own styles. All styling is removed (`unstyled={true}`).",
      },
    },
  },
};

export const HiddenWhenRemovable: Story = {
  name: "Hidden (hideBranding + removable)",
  parameters: {
    docs: {
      description: {
        story:
          "When the customer's plan allows it (`branding.removable === true`) and `hideBranding` is set on the provider, the component renders nothing.",
      },
    },
  },
  decorators: [
    (Story) => (
      <HideBrandingProvider removable hide>
        <div className="w-full max-w-md rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <p>Branding is hidden — only this placeholder is visible.</p>
          <Story />
        </div>
      </HideBrandingProvider>
    ),
  ],
  args: {
    variant: "card",
  },
};

export const NotHiddenWhenLocked: Story = {
  name: "Not hidden (locked plan)",
  parameters: {
    docs: {
      description: {
        story:
          "Even when `hideBranding` is set on the provider, the branding remains visible on plans where `branding.removable === false`.",
      },
    },
  },
  decorators: [
    (Story) => (
      <HideBrandingProvider removable={false} hide>
        <Story />
      </HideBrandingProvider>
    ),
  ],
  args: {
    variant: "card",
  },
};

export const Dark: Story = {
  parameters: {
    themes: {
      themeOverride: "dark",
    },
  },
  args: {
    variant: "card",
  },
};
