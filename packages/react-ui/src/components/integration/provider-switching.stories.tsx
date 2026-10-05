import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  installKaitenFetchMock,
  restoreKaitenFetchMock,
  scenarioPortalDefault,
  STORYBOOK_API_BASE,
  STORY_IDS,
} from "../../../.storybook/kaiten-mock.tsx";
import { KaitenSessionProvider } from "@kaitencloud/react";
import { KaitenStyleRoot } from "../../style-root/kaiten-style-root.tsx";
import { CustomerPortal } from "../customer-portal/customer-portal.tsx";
import { PricingTable } from "../pricing-table/pricing-table.tsx";

const scenario = scenarioPortalDefault();

const meta: Meta = {
  title: "Integration/Provider Switching",
  parameters: {
    docs: {
      description: {
        component:
          "Public pricing and authenticated customer portal share one top-level Kaiten session provider. Toggle the state to verify the SDK scope switches without nesting providers.",
      },
    },
  },
};

export default meta;

type Story = StoryObj;

function useProviderSwitchingMock() {
  // Install synchronously so the first SWR request during render uses the Storybook mock.
  installKaitenFetchMock(scenario);
  React.useEffect(() => restoreKaitenFetchMock, []);
}

function ProviderSwitchingDemo() {
  useProviderSwitchingMock();
  const [authenticated, setAuthenticated] = React.useState(false);

  return (
    <KaitenSessionProvider
      publicConfig={{
        mode: "public",
        apiUrl: STORYBOOK_API_BASE,
        publishableKey: "pk_storybook",
        polling: { enabled: false },
      }}
      authenticatedConfig={
        authenticated
          ? {
              mode: "authenticated",
              apiUrl: STORYBOOK_API_BASE,
              accessToken: "storybook-token",
              customerId: STORY_IDS.customer,
              instanceId: STORY_IDS.instance,
              polling: { enabled: false },
            }
          : null
      }
    >
      <KaitenStyleRoot
        appearance={{
          variables: {
            colorPrimary: authenticated ? "#2563eb" : "#0f766e",
            colorRing: authenticated ? "#93c5fd" : "#5eead4",
            borderRadius: "0.75rem",
          },
        }}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-ktn-lg border border-ktn-border bg-ktn-card p-4 text-ktn-card-foreground shadow-ktn-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-ktn-muted-foreground">
                {authenticated ? "Authenticated mode" : "Public mode"}
              </p>
              <h2 className="text-xl font-semibold">
                {authenticated ? "Customer licensing workspace" : "Visitor pricing page"}
              </h2>
            </div>
            <button
              type="button"
              aria-pressed={authenticated}
              className="inline-flex h-10 items-center justify-center rounded-ktn-md bg-ktn-primary px-4 text-sm font-medium text-ktn-primary-foreground transition-colors hover:bg-ktn-primary/90 focus-visible:ring-2 focus-visible:ring-ktn-ring focus-visible:outline-none"
              onClick={() => setAuthenticated((value) => !value)}
            >
              {authenticated ? "Return to pricing" : "Sign in"}
            </button>
          </div>
          {authenticated ? <CustomerPortal /> : <PricingTable showFeatureComparison={false} />}
        </div>
      </KaitenStyleRoot>
    </KaitenSessionProvider>
  );
}

export const PublicToAuthenticated: Story = {
  render: () => <ProviderSwitchingDemo />,
};
