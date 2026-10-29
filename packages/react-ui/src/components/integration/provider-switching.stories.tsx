// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import {
  installKaitenFetchMock,
  restoreKaitenFetchMock,
  scenarioPortalDefault,
  STORYBOOK_API_BASE,
} from "../../../.storybook/kaiten-mock.tsx";
import { API, sessionServer } from "../../../.storybook/session-server.ts";
import { KaitenScopeProvider } from "@kaitencloud/react";
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
          'What a vendor mounts for its own customers: the public pricing a visitor sees, then, once they sign in, their own portal under a customer session, both under one top-level `KaitenScopeProvider`. Toggle the state to verify the SDK scope switches without nesting providers. An application whose users are members of the organization switches to `mode: "authenticated"` instead; its token carries rights over the whole organization, so it never goes to a customer\'s browser.',
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
  const [signedIn, setSignedIn] = React.useState(false);
  // One session per sign-in, as a host's backend mints one for each signed-in customer: the
  // real session client, answering what Kaiten answered for Initech. A new client is a new scope.
  const session = React.useMemo(() => (signedIn ? sessionServer() : null), [signedIn]);

  return (
    <KaitenScopeProvider
      publicConfig={{
        mode: "public",
        apiUrl: STORYBOOK_API_BASE,
        publishableKey: "pk_storybook",
        polling: { enabled: false },
      }}
      authenticatedConfig={
        session
          ? {
              mode: "customer-session",
              sessionClient: session.client,
              apiUrl: API,
              polling: { enabled: false },
            }
          : null
      }
    >
      <KaitenStyleRoot
        appearance={{
          variables: {
            colorPrimary: signedIn ? "#2563eb" : "#0f766e",
            colorRing: signedIn ? "#93c5fd" : "#5eead4",
            borderRadius: "0.75rem",
          },
        }}
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 rounded-ktn-lg border border-ktn-border bg-ktn-card p-4 text-ktn-card-foreground shadow-ktn-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium text-ktn-muted-foreground">
                {signedIn ? "Customer session" : "Public mode"}
              </p>
              <h2 className="text-xl font-semibold">
                {signedIn ? "The customer's own portal" : "Visitor pricing page"}
              </h2>
            </div>
            <button
              type="button"
              aria-pressed={signedIn}
              className="inline-flex h-10 items-center justify-center rounded-ktn-md bg-ktn-primary px-4 text-sm font-medium text-ktn-primary-foreground transition-colors hover:bg-ktn-primary/90 focus-visible:ring-2 focus-visible:ring-ktn-ring focus-visible:outline-none"
              onClick={() => setSignedIn((value) => !value)}
            >
              {signedIn ? "Sign out" : "Sign in"}
            </button>
          </div>
          {signedIn ? <CustomerPortal /> : <PricingTable showFeatureComparison={false} />}
        </div>
      </KaitenStyleRoot>
    </KaitenScopeProvider>
  );
}

const SLOW = { timeout: 5_000 };

export const PublicToCustomerSession: Story = {
  render: () => <ProviderSwitchingDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));
    // The customer's own portal, read through the session: their plan and their invoices.
    await canvas.findByText("Pro", {}, SLOW);
    await expect((await canvas.findAllByText("Invoices", {}, SLOW)).length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));
    await expect(await canvas.findByText("Visitor pricing page")).toBeInTheDocument();
  },
};
