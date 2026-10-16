// @vitest-environment jsdom
//
// The add-ons a customer session's portal offers beside the ones its instance holds: the public
// add-ons of the catalogue that fit the plan, and of those only the ones Kaiten attaches to its
// subscription. Kaiten attaches no add-on priced in another currency than the subscription's, nor
// a paid one whose flat fees have no default for the subscription's billing period, so a + on
// either could only be refused. An add-on billed no flat fee, metered only, free or custom, has no
// period to be checked for. What the instance holds is listed whatever its prices.
//
// The catalogue is Acme's, as Kaiten serves it, read by the real client: Extra seats in euros,
// monthly and annual, and a GPU pack priced in dollars only. Initech's portal is on Pro, in euros.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { AddOns, usePlans } from "../src/index.ts";
import { API, sessionServer } from "../.storybook/session-server.ts";
import { acmeCatalog, freshPublishableKey, stubCatalogApi } from "./support/acme-catalog.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type RawPortal = Record<string, any>;

/** Initech's portal as recorded, with `changes` over it. */
const portalOf = (changes: RawPortal): RawPortal => ({
  ...structuredClone(answers.portal),
  ...changes,
});

/** The recorded subscription, billed every `billingPeriod`. */
const billedEvery = (billingPeriod: string) => ({ ...answers.portal.subscription, billingPeriod });

const held = (slug: string) =>
  structuredClone(answers.portal.addOns.find((addon) => addon.addonSlug === slug)!);

/** Says when the catalogue was read: the add-ons are drawn from the same read. */
function CatalogRead() {
  const plans = usePlans().data;
  return plans ? <p data-testid="catalog-read">{plans.length}</p> : null;
}

async function drawAddOns(portal: RawPortal, catalog: unknown = acmeCatalog) {
  stubCatalogApi({ body: catalog });
  const server = sessionServer({ portal });
  render(
    <KaitenProvider
      mode="customer-session"
      sessionClient={server.client}
      apiUrl={API}
      publishableKey={freshPublishableKey()}
      polling={{ enabled: false }}
    >
      <CatalogRead />
      <AddOns />
    </KaitenProvider>,
  );
  await screen.findByTestId("catalog-read");
  await waitFor(() => expect(server.to("GET", "portal")).toHaveLength(1));
}

/** The names of the add-ons listed, in their order. */
const listed = () =>
  [...document.querySelectorAll('[data-slot="addon"]')].map(
    (row) => row.querySelector("span")!.textContent,
  );

test("an add-on priced only in another currency than the subscription's is not offered", async () => {
  // A subscription in euros, holding nothing: the seats are sold in euros, the GPU pack in dollars.
  await drawAddOns(portalOf({ addOns: [] }));

  await waitFor(() => expect(listed()).toEqual(["Extra seats"]));
  expect(screen.queryByText("GPU pack")).toBeNull();
  expect(screen.queryByRole("button", { name: "Add one GPU pack" })).toBeNull();
});

test("an add-on the instance holds is listed whatever its prices, with its controls", async () => {
  // The GPU pack is held, priced in dollars beside a subscription in euros: it stays, and so does
  // the way to remove it. The seats, which it does not hold, are offered beside it.
  await drawAddOns(portalOf({ addOns: [held("gpu-pack-v1")] }));

  await waitFor(() => expect(listed()).toEqual(["GPU pack", "Extra seats"]));
  expect(screen.getByRole("status", { name: "Quantity of GPU pack" }).textContent).toBe("1");
  expect(screen.getByRole("button", { name: "Remove one GPU pack" })).toBeTruthy();
});

test("an add-on with no fee for the subscription's billing period is not offered", async () => {
  // Pro is sold every quarter, and the seats only by the month and by the year.
  await drawAddOns(portalOf({ subscription: billedEvery("QUARTERLY"), addOns: [] }));
  expect(screen.getByTestId("catalog-read").textContent).toBe("8");
  // Nothing held and nothing to offer: no section at all.
  expect(listed()).toEqual([]);
  expect(screen.queryByText("Extra seats")).toBeNull();
  cleanup();

  // By the year, they are.
  await drawAddOns(portalOf({ subscription: billedEvery("ANNUAL"), addOns: [] }));
  await waitFor(() => expect(listed()).toEqual(["Extra seats"]));
});

test("without a subscription, every public add-on that fits the plan is offered, as before", async () => {
  await drawAddOns(portalOf({ subscription: null, addOns: [], upcomingInvoice: null }));

  await waitFor(() => expect(listed()).toEqual(["Extra seats", "GPU pack"]));
});

/** A public add-on that fits Pro, as the catalogue serves one, numbered `n`, with `prices`. */
const proAddon = (
  n: number,
  familySlug: string,
  name: string,
  pricingType: string,
  prices: object[],
) => ({
  familySlug,
  addonSlug: `${familySlug}-v1`,
  addonId: `00000000-0000-4000-8000-0000000000b${n}`,
  name,
  description: "",
  pricingType,
  maxQuantity: null,
  prices,
  entitlements: [],
  compatibleLicenseFamilies: ["pro"],
});

/**
 * Acme's catalogue, with three more add-ons that fit Pro and are billed no flat fee for its
 * billing period: GPU hours, metered only; Priority support, free, with a fee of 0 by the year
 * alone; and a Dedicated region, custom, with no price at all.
 */
function catalogWithUnflatAddOns() {
  const catalog = structuredClone(acmeCatalog) as Record<string, any>;
  catalog.addOns.push(
    proAddon(1, "gpu-hours", "GPU hours", "PAID", [
      {
        id: "00000000-0000-4000-8000-00000000b101",
        billingModel: "USAGE_BASED",
        billingTiming: "ARREARS",
        currency: "EUR",
        unitAmount: 90,
        unitAmountDecimal: "90",
        metered: { entitlementSlug: "gpu-hours", saleUnitFactor: "1" },
        displayOrder: 0,
        isDefault: false,
      },
    ]),
    proAddon(2, "priority-support", "Priority support", "FREE", [
      {
        id: "00000000-0000-4000-8000-00000000b201",
        billingModel: "FLAT_FEE",
        billingTiming: "ADVANCE",
        billingPeriod: "ANNUAL",
        currency: "EUR",
        unitAmount: 0,
        unitAmountDecimal: "0",
        displayLabel: "Annual",
        displayOrder: 0,
        isDefault: true,
      },
    ]),
    proAddon(3, "dedicated-region", "Dedicated region", "CUSTOM", []),
  );
  const pro = catalog.plans.find((plan: any) => plan.familySlug === "pro");
  pro.compatibleAddonFamilies.push("gpu-hours", "priority-support", "dedicated-region");
  return catalog;
}

test("an add-on billed no flat fee for the period is offered: metered only, free or custom", async () => {
  // Pro, every month, in euros. None of the three has a monthly fee, and Kaiten checks the period
  // of a paid add-on with flat fees only: the GPU pack alone, priced in dollars, is not offered.
  await drawAddOns(portalOf({ addOns: [] }), catalogWithUnflatAddOns());

  await waitFor(() =>
    expect(listed()).toEqual(["Extra seats", "GPU hours", "Priority support", "Dedicated region"]),
  );
  expect(screen.getByRole("button", { name: "Add one GPU hours" })).toBeTruthy();
  expect(screen.queryByText("GPU pack")).toBeNull();
});

test("an add-on billed no flat fee is still not offered in another currency than the subscription's", async () => {
  // Every add-on priced in dollars, where it has a price: of those that fit Pro, only the custom
  // one, which has no price and so none in another currency, is offered to a subscription in euros.
  const catalog = catalogWithUnflatAddOns();
  for (const addon of catalog.addOns) {
    for (const price of addon.prices) price.currency = "USD";
  }
  await drawAddOns(portalOf({ addOns: [] }), catalog);

  await waitFor(() => expect(listed()).toEqual(["Dedicated region"]));
});
