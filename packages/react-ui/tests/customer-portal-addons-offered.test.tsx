// @vitest-environment jsdom
//
// The add-ons a customer session's portal offers beside the ones its instance holds: the public
// add-ons of the catalogue that fit the plan, and of those only the ones its subscription can be
// billed. Kaiten attaches no add-on priced in another currency than the subscription's, nor one
// with no default fee for the subscription's billing period, so a + on either could only be
// refused. What the instance holds is listed whatever its prices.
//
// The catalogue is Acme's, as Kaiten serves it, read by the real client: Extra seats in euros,
// monthly and annual, and a GPU pack priced in dollars only. Initech's portal is on Pro, in euros.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { AddOns, usePlans } from "../src/index.ts";
import { API, sessionServer } from "../.storybook/session-server.ts";
import { freshPublishableKey, stubCatalogApi } from "./support/acme-catalog.ts";
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

async function drawAddOns(portal: RawPortal) {
  stubCatalogApi();
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
