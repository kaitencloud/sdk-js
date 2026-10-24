// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { resolve } from "node:path";
import { fr, es, de } from "@kaitencloud/react/locales";
import {
  AddOns,
  CurrentPlan,
  CustomerPortal,
  IncludedFeatures,
  VoucherEntry,
} from "../src/index.ts";
import type { Plan } from "../src/index.ts";
import { purchasablePrices } from "../src/components/shared/purchasable-prices.ts";
import { englishPortalBillingWords } from "../src/components/shared/billing-words.ts";
import { sessionServer } from "../.storybook/session-server.ts";
import { mount, press } from "./support/session-mount.tsx";
// Keep this test-only helper outside tsgo's declaration graph: a static cross-package import
// makes the pack emit contract-schema.d.ts beside the client's source.
const contractHelper = resolve(
  import.meta.dirname,
  "../../client/tests/support/contract-schema.ts",
);
const { responseProblems } = (await import(contractHelper)) as {
  responseProblems: (method: string, path: string, status: number, body: unknown) => string[];
};
import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const locales = [
  { name: "en", locale: undefined, words: englishPortalBillingWords },
  { name: "fr", locale: fr, words: fr.portalBilling! },
  { name: "es", locale: es, words: es.portalBilling! },
  { name: "de", locale: de, words: de.portalBilling! },
];
const variants = locales.flatMap((locale) =>
  [false, true].map((unstyled) => ({ ...locale, unstyled })),
);
const portal = (): Record<string, any> => structuredClone(answers.portal);

test("an older custom language pack's undefined additions keep the English fallback", async () => {
  const body = portal();
  body.addOns[0].pendingQuantity = 2;
  mount(
    sessionServer({ portal: body }),
    <CustomerPortal elements={["IncludedFeatures", "AddOns"]} />,
    { portalBilling: { addonPendingQuantity: undefined, provenanceLayer: undefined } },
  );
  expect(
    await screen.findByText(
      englishPortalBillingWords.addonPendingQuantity("2", body.subscription.currentPeriodEnd),
    ),
  ).toBeTruthy();
  const [button] = await screen.findAllByRole("button", {
    name: "How this limit is made up: API calls",
  });
  fireEvent.click(button!);
  expect(screen.getByRole("note").textContent).toContain("Source: Current plan.");
});

test("price choices use supplied display order, and missing order retains the older period order", () => {
  const plan: Plan = {
    slug: "plan",
    name: "Plan",
    billingPrices: [
      {
        id: "month",
        amount: 100,
        unitAmountDecimal: "100",
        currencyCode: "USD",
        billingModel: "FLAT_FEE",
        isDefault: true,
        interval: "month",
        displayOrder: 2,
      },
      {
        id: "year",
        amount: 1000,
        unitAmountDecimal: "1000",
        currencyCode: "USD",
        billingModel: "FLAT_FEE",
        isDefault: true,
        interval: "year",
        displayOrder: 1,
      },
    ],
  };
  expect(purchasablePrices(plan, undefined).map((price) => price.id)).toEqual(["year", "month"]);
  const older = {
    ...plan,
    billingPrices: plan.billingPrices!.map((price) => ({ ...price, displayOrder: undefined })),
  };
  expect(purchasablePrices(older, undefined).map((price) => price.id)).toEqual(["month", "year"]);
});

test.each(variants)(
  "$name, unstyled=$unstyled: pending quantities and removal retain the held units",
  async ({ locale, words, unstyled }) => {
    const body = portal();
    body.addOns[0].pendingQuantity = 2;
    body.addOns[1].pendingQuantity = 0;
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
    mount(sessionServer({ portal: body }), <AddOns unstyled={unstyled} />, locale);
    expect(
      await screen.findByText(words.addonPendingQuantity!("2", body.subscription.currentPeriodEnd)),
    ).toBeTruthy();
    expect(
      screen.getByText(words.addonPendingRemoval!(body.subscription.currentPeriodEnd)),
    ).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="addon-quantity"]')[0]?.textContent).toContain(
      "3",
    );
    expect(document.querySelectorAll('[data-slot="addon-quantity"]')[1]?.textContent).toContain(
      "1",
    );
    expect(screen.getByText(words.billingAdvance!)).toBeTruthy();
    expect(document.querySelector('[data-slot="addon-metered-price"]')?.textContent).toContain(
      words.billingArrears!,
    );
  },
);

test.each([null, undefined])(
  "no pending notice for %s, and unknown billing timing is not called advance",
  async (pending) => {
    const body = portal();
    for (const addon of body.addOns) {
      if (pending === undefined) delete addon.pendingQuantity;
      else addon.pendingQuantity = pending;
      for (const price of addon.prices) price.billingTiming = "DEFERRED";
    }
    const view = mount(sessionServer({ portal: body }), <AddOns />);
    await screen.findByText("Extra seats");
    expect(view.container.querySelector('[data-slot="addon-pending-quantity"]')).toBeNull();
    expect(view.container.querySelector('[data-slot="addon-billing-timing"]')).toBeNull();
  },
);

test("the panel opens on the scheduled quantity; retaining the held quantity clears the schedule", async () => {
  const body = portal();
  body.addOns[0].pendingQuantity = 2;
  const server = sessionServer({ portal: body });
  mount(server, <AddOns />);
  await press("Manage add-ons");
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByLabelText("Quantity of Extra seats").textContent).toBe("2");
  await press("Add one Extra seats");
  expect(within(dialog).getByText(englishPortalBillingWords.addonKeepQuantity)).toBeTruthy();
  expect(within(dialog).queryByText(/−0/)).toBeNull();
  await press("Confirm changes");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(server.to("PUT", "addons/extra-seats-v1")[0]?.body).toEqual({ quantity: 3 });
  expect(server.portal().addOns[0]).toMatchObject({ quantity: 3, pendingQuantity: null });
  expect(document.querySelector('[data-slot="addon-pending-quantity"]')).toBeNull();
});

test("an unknown subscription status does not promise when an add-on write will take effect", async () => {
  const body = portal();
  body.subscription.status = "PAUSED";
  mount(sessionServer({ portal: body }), <AddOns />);
  await press("Manage add-ons");
  await press("Add one Extra seats");
  const panel = within(screen.getByRole("dialog"));
  expect(
    panel.queryByText(/Takes effect now|takes effect on|Removal scheduled|Keep the current/),
  ).toBeNull();
});

test.each(variants)(
  "$name, unstyled=$unstyled: exception and tagged boosts are disclosed without recomputing the allowance",
  async ({ locale, words, unstyled }) => {
    const body = portal();
    const calls = body.entitlements.find((each: any) => each.slug === "api-calls");
    // Deliberately inconsistent provenance: the note must never become the source of access.
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
    calls.provenance.boosts[0] = {
      ...calls.provenance.boosts[0],
      modifierType: "SET",
      modifierValue: null,
      value: { type: "boolean", value: false },
    };
    expect(responseProblems("GET", "/public/session/portal", 200, body)).toEqual([]);
    mount(sessionServer({ portal: body }), <IncludedFeatures unstyled={unstyled} />, locale);
    const [button] = await screen.findAllByRole("button", {
      name: `${words.provenance}: ${calls.name}`,
    });
    fireEvent.mouseOver(button!);
    expect(button!.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button!);
    const note = screen.getByRole("note");
    expect(button!.getAttribute("aria-controls")).toBe(note.id);
    expect(note.getAttribute("data-exception-id")).toBe("exception-1");
    expect(note.textContent).toContain(words.provenanceBeforeException!("200,000"));
    expect(note.textContent).toContain(words.provenanceEffective!("777"));
    expect(note.textContent).toContain(
      words.grantSet!(locale?.includedFeatures?.disabled ?? "Disabled"),
    );
    expect(note.textContent).toContain(words.grantNoEnd!);
    expect(note.textContent).not.toMatch(/author|reason|expiry|payment/i);
  },
);

test.each(locales)(
  "$name: an ended subscription names the actual plan without inventing a fallback reason",
  async ({ locale }) => {
    const body = portal();
    body.subscription.status = "CANCELED";
    body.instance.licenseSlug = "starter-v1";
    body.instance.licenseName = "Starter";
    body.upcomingInvoice = null;
    body.capabilities.checkout = true;
    const view = mount(sessionServer({ portal: body }), <CurrentPlan />, locale);
    const expected =
      locale?.subscription?.canceledPlanNotice?.("Starter") ??
      "Your subscription has ended. Your current plan is Starter.";
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(view.container.textContent).not.toMatch(
      /BILLING_FALLBACK|INCOMPLETE_EXPIRED|TRIAL_ENDED|downgraded|free plan|23 h/i,
    );
  },
);

test("INCOMPLETE offers the latest activation's actual payment page and no deadline or purchased-plan price", async () => {
  const body = portal();
  body.subscription.status = "INCOMPLETE";
  body.instance.licenseName = "Starter";
  body.instance.licenseSlug = "starter-v1";
  const server = sessionServer({ portal: body });
  server.setInvoices(
    [
      {
        ...answers.invoicesFirstPage.items[0],
        kind: "ACTIVATION",
        status: "PAYMENT_FAILED",
        serviceFrom: body.subscription.currentPeriodStart,
        hostedInvoiceUrl: "https://pay.example.test/activation",
      },
    ],
    false,
  );
  const view = mount(server, <CurrentPlan />);
  expect(await screen.findByText("Your plan starts once your payment is confirmed.")).toBeTruthy();
  expect((await screen.findByRole("link", { name: "Pay" })).getAttribute("href")).toBe(
    "https://pay.example.test/activation",
  );
  expect(view.container.querySelector('[data-slot="current-plan-price"]')).toBeNull();
  expect(view.container.textContent).not.toMatch(/23|expires|Renews on|Ends on/);
});

test.each([null, "javascript:alert(1)"])(
  "INCOMPLETE with %s has no invented payment link",
  async (url) => {
    const body = portal();
    body.subscription.status = "INCOMPLETE";
    const server = sessionServer({ portal: body });
    server.setInvoices(
      [
        {
          ...answers.invoicesFirstPage.items[0],
          kind: "ACTIVATION",
          status: "PUSHED",
          serviceFrom: body.subscription.currentPeriodStart,
          hostedInvoiceUrl: url,
        },
      ],
      false,
    );
    mount(server, <CurrentPlan />);
    await screen.findByText("Your plan starts once your payment is confirmed.");
    await waitFor(() => expect(server.to("GET", "invoices").length).toBeGreaterThan(0));
    expect(screen.queryByRole("link", { name: "Pay" })).toBeNull();
  },
);

test.each(locales)(
  "$name: a composite voucher check shows boolean/config values, decimals and flag variants",
  async ({ locale, words }) => {
    const server = sessionServer({ portal: "portalNeverSubscribed" });
    server.script("POST vouchers/validate", {
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
            {
              entitlementSlug: "settings",
              modifierType: "SET",
              value: { type: "custom", value: false },
            },
            { entitlementSlug: "tokens", modifierType: "MULTIPLY", modifierValue: "2.5" },
          ],
          flagGrants: [{ flagSlug: "new-dashboard", variant: "enabled" }],
        },
      },
    });
    mount(server, <VoucherEntry />, locale);
    const input = await screen.findByLabelText(words.voucherLabel);
    fireEvent.change(input, { target: { value: "LAUNCH" } });
    await press(words.voucherCheck);
    expect(await screen.findByText(words.voucherDiscount!("20%"))).toBeTruthy();
    expect(
      screen.getByText(
        `Single sign-on: ${words.grantSet!(locale?.includedFeatures?.disabled ?? "Disabled")}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText(`branding: ${words.grantSet!('{"logo":"launch"}')}`)).toBeTruthy();
    expect(
      screen.getByText(`settings: ${words.grantSet!('{"type":"custom","value":false}')}`),
    ).toBeTruthy();
    expect(screen.getByText(`tokens: ${words.grantMultiply!("2.5")}`)).toBeTruthy();
    expect(screen.getByText(words.voucherFlag!("new-dashboard", "enabled"))).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("");
    expect(server.to("POST", "vouchers/redeem")).toHaveLength(0);
  },
);

test.each([
  { allowed: true, request: true, visible: false },
  { allowed: true, request: false, visible: true },
  { allowed: false, request: true, visible: true },
  { allowed: undefined, request: true, visible: true },
])(
  "branding follows permission=$allowed and request=$request",
  async ({ allowed, request, visible }) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = portal();
    if (allowed === undefined) delete body.branding;
    else body.branding.poweredByRemovable = allowed;
    const server = sessionServer({ portal: body });
    mount(server, <CustomerPortal elements={["CurrentPlan"]} />, undefined, {
      hideBranding: request,
    });
    await screen.findByText("Pro");
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Powered by Kaiten" }) !== null).toBe(visible),
    );
  },
);

test("omitted/null voucher parts leave no empty list or invented effect", async () => {
  const server = sessionServer({ portal: "portalNeverSubscribed" });
  server.script("POST vouchers/validate", {
    status: 200,
    body: {
      valid: true,
      voucher: {
        name: "No visible parts",
        voucherType: "FLAG_GRANT",
        duration: "FOREVER",
        flagGrants: null,
        boosts: [{ entitlementSlug: "sso", modifierType: "SET", value: null }],
      },
    },
  });
  const view = mount(server, <VoucherEntry />);
  fireEvent.change(await screen.findByLabelText("Voucher code"), { target: { value: "EMPTY" } });
  await press("Check");
  expect(await screen.findByText("No visible parts — Applied at checkout.")).toBeTruthy();
  expect(view.container.querySelector('[data-slot="voucher-parts"]')).toBeNull();
});
