// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { fr, es, de } from "@kaitencloud/react/locales";
import type { KaitenLocalizationOverrides } from "@kaitencloud/react";
import { initechSession } from "../../../.storybook/kaiten-mock.tsx";
import { portalDecorator } from "../../../.storybook/portal-mock.tsx";
import { englishPortalBillingWords, englishSubscriptionWords } from "../shared/billing-words.ts";
import { CustomerPortal } from "./customer-portal.tsx";

const meta: Meta<typeof CustomerPortal> = {
  title: "Flows/Customer portal (mapped billing)",
  component: CustomerPortal,
};
export default meta;
type Story = StoryObj<typeof meta>;
const SLOW = { timeout: 5000 };

function mappedPortal(): Record<string, any> {
  const body: Record<string, any> = structuredClone(initechSession.portal);
  body.addOns[0].pendingQuantity = 2;
  body.addOns[1].pendingQuantity = 0;
  const calls = body.entitlements.find((each: any) => each.slug === "api-calls");
  calls.source = "exception";
  calls.provenance.exception = {
    instanceEntitlementExceptionId: "exception-1",
    kind: "SET",
    value: { type: "number", value: 777 },
    startsAt: "2026-10-01T00:00:00Z",
    endsAt: null,
  };
  calls.provenance.number.afterBoosts = 200000;
  calls.provenance.number.effective = 777;
  calls.limitValue = { type: "number", value: 777 };
  calls.currentValue = 300;
  calls.maximumAllowedUsage = 932.4;
  calls.percentageUsed = 38.61;
  const sso = body.entitlements.find((each: any) => each.slug === "sso");
  sso.limitValue = { type: "boolean", value: false };
  sso.provenance.boosts = [
    {
      ...calls.provenance.boosts[0],
      voucherEntitlementGrantId: "sso-boost-1",
      modifierType: "SET",
      modifierValue: null,
      value: { type: "boolean", value: false },
    },
  ];
  return body;
}

function active(locale?: KaitenLocalizationOverrides, unstyled = false): Story {
  const body = mappedPortal();
  const words = { ...englishPortalBillingWords, ...locale?.portalBilling };
  return {
    args: { elements: ["CurrentPlan", "IncludedFeatures", "AddOns"], unstyled },
    decorators: [portalDecorator({ portal: body }, locale)],
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      await expect(
        await canvas.findByText(
          words.addonPendingQuantity("2", body.subscription.currentPeriodEnd),
          {},
          SLOW,
        ),
      ).toBeInTheDocument();
      await expect(
        canvas.getByText(words.addonPendingRemoval(body.subscription.currentPeriodEnd)),
      ).toBeInTheDocument();
      const [button] = await canvas.findAllByRole(
        "button",
        { name: `${words.provenance}: API calls` },
        SLOW,
      );
      await userEvent.hover(button!);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      button!.focus();
      await userEvent.keyboard("{Enter}");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      const note = canvas.getByRole("note");
      await expect(note).toHaveTextContent(words.provenanceEffective("777"));
      await expect(note).toHaveAttribute("data-exception-id", "exception-1");
      await expect(note).toHaveTextContent(words.grantNoEnd);
      await userEvent.keyboard("{Enter}");
      await expect(canvas.queryByRole("note")).toBeNull();
      const [booleanNote] = canvas.getAllByRole("button", {
        name: `${words.provenance}: Single sign-on`,
      });
      booleanNote!.focus();
      await userEvent.keyboard("{Enter}");
      await expect(canvas.getByRole("note")).toHaveTextContent(
        words.grantSet(locale?.includedFeatures?.disabled ?? "Disabled"),
      );
    },
  };
}

export const English: Story = active();
export const French: Story = active(fr);
export const Spanish: Story = active(es);
export const German: Story = active(de);
export const Unstyled: Story = active(undefined, true);

const waiting: Record<string, any> = {
  ...structuredClone(initechSession.portalNeverSubscribed),
  subscription: { ...structuredClone(initechSession.portal.subscription), status: "INCOMPLETE" },
};
waiting.capabilities.unsubscribe = false;
waiting.capabilities.checkout = false;
waiting.subscription.incompleteExpiresAt = "2026-10-24T12:34:00Z";

export const AwaitingPayment: Story = {
  args: { elements: ["CurrentPlan"] },
  decorators: [
    portalDecorator({
      portal: waiting,
      invoices: [
        {
          ...initechSession.invoicesFirstPage.items[1],
          kind: "ACTIVATION",
          status: "PAYMENT_FAILED",
          serviceFrom: waiting.subscription.currentPeriodStart,
          paidAt: null,
          hostedInvoiceUrl: "https://pay.initech.test/activation",
        },
      ],
      hasMore: false,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("Your plan starts once your payment is confirmed.", {}, SLOW),
    ).toBeInTheDocument();
    await expect(await canvas.findByRole("link", { name: "Pay" }, SLOW)).toHaveAttribute(
      "href",
      "https://pay.initech.test/activation",
    );
    await expect(canvasElement.querySelector('[data-slot="current-plan-price"]')).toBeNull();
    await expect(canvas.queryByText(/23 hours|Expires on|Renews on/)).toBeNull();
  },
};

const ended = {
  ...structuredClone(initechSession.portalNeverSubscribed),
  subscription: {
    ...structuredClone(initechSession.portal.subscription),
    status: "CANCELED",
    cancelAtPeriodEnd: false,
  },
};

export const CurrentPlanAfterCancellation: Story = {
  args: { elements: ["CurrentPlan"], onUpgradeVersion: () => {} },
  decorators: [portalDecorator({ portal: ended })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(
        "Your subscription has ended. Your current plan is Starter.",
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
    await expect(canvas.queryByText(/BILLING_FALLBACK|INCOMPLETE_EXPIRED/)).toBeNull();
  },
};

export const ExpiredCheckout: Story = {
  args: { elements: ["CurrentPlan"] },
  decorators: [
    portalDecorator({
      portal: {
        ...ended,
        subscription: {
          ...ended.subscription,
          canceledAt: "2026-10-24T12:34:00Z",
          cancellationReason: "INCOMPLETE_EXPIRED",
        },
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(
        englishSubscriptionWords.canceledOn("2026-10-24T12:34:00Z"),
        {},
        SLOW,
      ),
    ).toBeInTheDocument();
    await expect(
      canvas.getByText(/^The time to confirm your payment has run out\./),
    ).toBeInTheDocument();
  },
};

export const TrialEndedWithoutPaymentMethod: Story = {
  args: { elements: ["CurrentPlan"] },
  decorators: [
    portalDecorator({
      portal: {
        ...ended,
        subscription: {
          ...ended.subscription,
          canceledAt: "2026-10-24T12:34:00Z",
          cancellationReason: "TRIAL_ENDED_WITHOUT_PAYMENT_METHOD",
        },
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText(/^Your trial ended without a payment method\./, {}, SLOW),
    ).toBeInTheDocument();
  },
};

export const CompositeVoucher: Story = {
  args: { elements: ["VoucherEntry"] },
  decorators: [
    portalDecorator({
      portal: "portalNeverSubscribed",
      scripts: {
        "POST vouchers/validate": [
          {
            status: 200,
            body: {
              valid: true,
              voucher: {
                name: "Launch",
                voucherType: "COMPOSITE",
                duration: "REPEATING",
                durationInPeriods: 3,
                discount: { type: "PERCENTAGE", value: "20", appliesTo: "LICENSE_BASE" },
                boosts: [
                  { entitlementSlug: "sso", modifierType: "SET", value: false },
                  { entitlementSlug: "branding", modifierType: "SET", value: { logo: "launch" } },
                ],
                flagGrants: [{ flagSlug: "new-dashboard", variant: "enabled" }],
              },
            },
          },
        ],
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByLabelText("Voucher code", {}, SLOW), "LAUNCH");
    await userEvent.click(canvas.getByRole("button", { name: "Check" }));
    await expect(await canvas.findByText("20% off.", {}, SLOW)).toBeInTheDocument();
    await expect(canvas.getByText("Single sign-on: Set to Disabled")).toBeInTheDocument();
    await expect(canvas.getByText('branding: Set to {"logo":"launch"}')).toBeInTheDocument();
    await expect(canvas.getByText("Feature new-dashboard: enabled.")).toBeInTheDocument();
  },
};

export const BrandingAllowed: Story = {
  args: { elements: ["CurrentPlan"] },
  decorators: [
    portalDecorator({
      portal: { ...mappedPortal(), branding: { poweredByRemovable: true } },
      hideBranding: true,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Pro", {}, SLOW);
    await expect(canvas.queryByRole("link", { name: "Powered by Kaiten" })).toBeNull();
  },
};

export const BrandingRequired: Story = {
  args: { elements: ["CurrentPlan"] },
  decorators: [portalDecorator({ portal: mappedPortal(), hideBranding: true })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Pro", {}, SLOW);
    await expect(canvas.getByRole("link", { name: "Powered by Kaiten" })).toBeInTheDocument();
  },
};
