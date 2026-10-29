// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import type * as React from "react";
import { action } from "storybook/actions";

import {
  KaitenPublicStoryProvider,
  scenarioPortalDefault,
} from "../../../.storybook/kaiten-mock.tsx";
import { PricingTable, type PricingPlan } from "../pricing-table/pricing-table.tsx";

const integrationScenario = scenarioPortalDefault();

const hostShellStyle = {
  "--background": "#fff7ed",
  "--foreground": "#431407",
  "--primary": "#9a3412",
  "--primary-foreground": "#ffffff",
  "--border": "#fed7aa",
  "--radius": "1.25rem",
} as React.CSSProperties;

const integrationPlans: PricingPlan[] = [
  {
    id: "team",
    slug: "team",
    name: "Team",
    description: "Shared licensing for growing teams.",
    price: 7900,
    currencyCode: "USD",
    interval: "month",
    features: ["10 seats", "Usage alerts", "Priority support"],
  },
  {
    id: "business",
    slug: "business",
    name: "Business",
    description: "Higher quota and white-label controls.",
    price: 14900,
    currencyCode: "USD",
    interval: "month",
    highlighted: true,
    badge: "Recommended",
    features: ["50 seats", "Advanced entitlements", "Custom branding"],
  },
];

const meta: Meta = {
  title: "Integration/Tailwind v4 Host",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        story:
          "A host app shell defines generic Tailwind-style tokens (`--primary`, `--background`, `--radius`) around the SDK. Kaiten remains scoped through `--ktn-*` and provider `appearance` overrides.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const ConflictingHostTokens: Story = {
  name: "Conflicting host tokens",
  render: () => (
    <div className="w-full bg-[var(--background)] p-4 text-[var(--foreground)] sm:p-8">
      <style>
        {`
          .tw4-host-shell {
            background:
              linear-gradient(135deg, color-mix(in oklab, var(--primary) 16%, transparent), transparent 34%),
              var(--background);
            border-color: var(--border);
            border-radius: var(--radius);
          }

          .tw4-host-shell .host-action {
            background: var(--primary);
            color: var(--primary-foreground);
            border-radius: calc(var(--radius) - 0.4rem);
          }
        `}
      </style>
      <section
        className="tw4-host-shell mx-auto grid w-full max-w-6xl gap-6 border p-4 shadow-sm lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]"
        style={hostShellStyle}
      >
        <div className="flex min-w-0 flex-col justify-between gap-6 rounded-lg border border-[var(--border)] bg-white/60 p-5">
          <div className="space-y-3">
            <p className="text-sm font-medium uppercase text-[var(--primary)]">Host billing</p>
            <h2 className="text-2xl font-semibold">Acme SaaS</h2>
            <p className="text-sm leading-6">
              Manage billing and access for the workspace from one place.
            </p>
          </div>
          <button className="host-action h-10 px-4 text-sm font-medium" type="button">
            Host action
          </button>
        </div>

        <KaitenPublicStoryProvider scenario={integrationScenario}>
          <PricingTable
            plans={integrationPlans}
            numberOfColumns={2}
            showFeatureComparison={false}
            onSelectPlan={action("onSelectPlan")}
            appearance={{
              zIndex: 260,
              variables: {
                colorPrimary: "#0f766e",
                colorAccent: "#ccfbf1",
                colorAccentForeground: "#134e4a",
                colorRing: "#0f766e",
                borderRadius: "0.625rem",
              },
            }}
          />
        </KaitenPublicStoryProvider>
      </section>
    </div>
  ),
};
