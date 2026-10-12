// @vitest-environment jsdom
//
// `PricingTable` on the catalogue Kaiten serves for Acme: 8 plans in 3 currencies,
// read from `GET /public/catalog` by the real client and drawn by the real provider.
//
// `pricing-table-billing.test.tsx` holds the table to catalogues written by hand; this
// holds it to what the client makes of a real one, where a plan's quarterly and usage
// prices are in `billingPrices` and never in `prices`, a plan can have no default fee,
// and only one plan sells an annual one.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { fr } from "@kaitencloud/react/locales";

import {
  KaitenError,
  PricingTable,
  usePlans,
  type KaitenLocalizationOverrides,
} from "../src/index.ts";
import { KaitenProvider } from "./support/styled-provider.tsx";
import {
  acmeCatalog,
  freshPublishableKey,
  originNotAllowed,
  stubCatalogApi,
} from "./support/acme-catalog.ts";

const API = "https://kaiten.test/api";

beforeEach(() => {
  // The plans that have no default fee warn, as they should.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTable(
  props: Partial<Parameters<typeof PricingTable>[0]> = {},
  provider: { locale?: KaitenLocalizationOverrides } = {},
) {
  return render(
    <KaitenProvider
      mode="public"
      apiUrl={API}
      publishableKey={freshPublishableKey()}
      polling={{ enabled: false }}
      {...provider}
    >
      <PricingTable showFeatureComparison={false} {...props} />
    </KaitenProvider>,
  );
}

const cards = () => [...document.querySelectorAll('[data-slot="card"]')] as HTMLElement[];
const titleOf = (card: HTMLElement) => card.querySelector('[data-slot="card-title"]')!.textContent;

async function card(name: string): Promise<HTMLElement> {
  const title = await screen.findByText(name, { selector: '[data-slot="card-title"]' });
  return title.closest('[data-slot="card"]') as HTMLElement;
}

test("draws the 8 plans of the catalogue, in the order Kaiten serves them", async () => {
  const { requests } = stubCatalogApi();
  renderTable();

  await screen.findByText("Starter", { selector: '[data-slot="card-title"]' });
  expect(cards().map(titleOf)).toEqual(acmeCatalog.plans.map((plan) => plan.name));
  expect(cards()).toHaveLength(8);
  // One read of the catalogue, with the publishable key and nothing else.
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual(["/api/public/catalog"]);
  expect(requests[0]!.headers.get("Authorization")).toBeNull();
});

test("the monthly fee reads per month, and the quarterly one is nowhere under it", async () => {
  stubCatalogApi();
  renderTable();

  const pro = within(await card("Pro"));
  expect(pro.getByText("€49.00")).toBeTruthy();
  expect(pro.getByText("/month")).toBeTruthy();
  // The quarterly (€135.00), half-yearly (€260.00), legacy (€45.00) and usage prices
  // are not the headline.
  for (const other of ["€135.00", "€260.00", "€45.00", "€2.00", "€490.00"]) {
    expect(pro.queryByText(other), other).toBeNull();
  }
  expect(pro.queryByText("/year")).toBeNull();
});

test("the annual toggle shows the annual fee, and every other plan keeps its own period", async () => {
  stubCatalogApi();
  renderTable();
  await card("Pro");

  fireEvent.click(screen.getByRole("radio", { name: "Annual" }));

  const pro = within(await card("Pro"));
  expect(pro.getByText("€490.00")).toBeTruthy();
  expect(pro.getByText("/year")).toBeTruthy();

  // Only Pro sells an annual fee. The others show the monthly one they have, as
  // "/month": never a monthly price under "/year".
  for (const [name, price] of [
    ["Starter", "€0.00"],
    ["Growth", "€99.00"],
    ["Lite", "€19.00"],
    ["Japan", "¥980"],
    ["Kuwait", "KWD 12.500"],
  ] as const) {
    const plan = within(await card(name));
    expect(plan.getByText(price), name).toBeTruthy();
    expect(plan.getByText("/month"), name).toBeTruthy();
    expect(plan.queryByText("/year"), name).toBeNull();
  }
});

test("yen have no decimals and dinars have three", async () => {
  stubCatalogApi();
  renderTable();

  expect(within(await card("Japan")).getByText("¥980")).toBeTruthy();
  expect(within(await card("Kuwait")).getByText("KWD 12.500")).toBeTruthy();
});

test("a plan sold by contact has no price and links to its page; one with no default fee has no action", async () => {
  stubCatalogApi();
  renderTable();

  const enterprise = within(await card("Enterprise"));
  expect(enterprise.getByText("Custom")).toBeTruthy();
  expect(enterprise.queryByRole("button")).toBeNull();
  expect(enterprise.getByRole("link", { name: "Contact us" }).getAttribute("href")).toBe(
    "https://acme.test/contact",
  );

  // Solo has a monthly fee, but not a default one: it is not the plan's headline
  // price, and the catalogue says nobody can subscribe to it by themselves.
  const solo = within(await card("Solo"));
  expect(solo.getByText("Custom")).toBeTruthy();
  expect(solo.queryByText("€9.00")).toBeNull();
  expect(solo.queryByRole("button")).toBeNull();
  expect(solo.queryByText("Contact us")).toBeNull();
});

test("a self-serve plan hands back the plan and the price of the interval it showed", async () => {
  stubCatalogApi();
  const onSelectPlan = vi.fn();
  renderTable({ onSelectPlan });

  fireEvent.click(within(await card("Pro")).getByRole("button"));
  expect(onSelectPlan).toHaveBeenCalledTimes(1);
  let [slug, plan, price] = onSelectPlan.mock.lastCall!;
  expect(slug).toBe("pro-v2");
  expect(plan.name).toBe("Pro");
  expect(price).toMatchObject({ id: "00000000-0000-4000-8000-000000000201", amount: 4900 });

  fireEvent.click(screen.getByRole("radio", { name: "Annual" }));
  fireEvent.click(within(await card("Pro")).getByRole("button"));
  [slug, plan, price] = onSelectPlan.mock.lastCall!;
  expect(price).toMatchObject({ id: "00000000-0000-4000-8000-000000000204", amount: 49000 });

  // Starter is free and self-serve: its action hands back its zero fee.
  fireEvent.click(within(await card("Starter")).getByRole("button"));
  expect(onSelectPlan.mock.lastCall![2]).toMatchObject({
    id: "00000000-0000-4000-8000-000000000101",
    amount: 0,
  });
});

/** Acme's catalogue with `pro` sold quarterly only: its monthly fee is not the default. */
function quarterlyOnlyCatalog() {
  return {
    ...acmeCatalog,
    plans: acmeCatalog.plans.map((plan) =>
      plan.licenseSlug === "pro-v2"
        ? {
            ...plan,
            prices: plan.prices.map((price) =>
              "billingPeriod" in price &&
              ["MONTHLY", "ANNUAL", "SEMI_ANNUAL"].includes(price.billingPeriod!)
                ? { ...price, isDefault: false }
                : price,
            ),
          }
        : plan,
    ),
  };
}

test("a plan whose only default fee is quarterly reads every 3 months, never per month", async () => {
  stubCatalogApi({ body: quarterlyOnlyCatalog() });
  const onSelectPlan = vi.fn();
  renderTable({ onSelectPlan });

  const pro = within(await card("Pro"));
  expect(pro.getByText("€135.00")).toBeTruthy();
  expect(pro.getByText("every 3 months")).toBeTruthy();
  expect(pro.queryByText("/month")).toBeNull();

  // What the checkout would name is the quarterly price the card showed.
  fireEvent.click(pro.getByRole("button"));
  expect(onSelectPlan.mock.lastCall![2]).toMatchObject({
    id: "00000000-0000-4000-8000-000000000202",
    amount: 13500,
    intervalCount: 3,
  });

  // Unstyled, the same line is one sentence.
  cleanup();
  stubCatalogApi({ body: quarterlyOnlyCatalog() });
  const { container } = renderTable({ unstyled: true });
  await waitFor(() => expect(container.querySelectorAll("article").length).toBe(8));
  const article = [...container.querySelectorAll("article")].find(
    (candidate) => candidate.querySelector("h3")?.textContent === "Pro",
  )!;
  expect(within(article as HTMLElement).getByText("€135.00 every 3 months")).toBeTruthy();
});

test("in French, the periods are French and the amounts are too", async () => {
  stubCatalogApi({ body: quarterlyOnlyCatalog() });
  renderTable({}, { locale: fr });

  const pro = within(await card("Pro"));
  expect(pro.getByText("135,00 €")).toBeTruthy();
  expect(pro.getByText("tous les 3 mois")).toBeTruthy();
  expect(within(await card("Starter")).getByText("/mois")).toBeTruthy();
});

test("unstyled: the same prices on the same 8 plans", async () => {
  stubCatalogApi();
  const { container } = renderTable({ unstyled: true });

  await waitFor(() => expect(container.querySelectorAll("article").length).toBe(8));
  const articles = [...container.querySelectorAll("article")].map((article) => ({
    name: article.querySelector("h3")!.textContent,
    price: article.querySelector("h3 ~ p:last-of-type, h3 + p")?.textContent,
  }));
  expect(articles.map((article) => article.name)).toEqual(
    acmeCatalog.plans.map((plan) => plan.name),
  );
  const pro = within(
    [...container.querySelectorAll("article")].find(
      (article) => article.querySelector("h3")?.textContent === "Pro",
    ) as HTMLElement,
  );
  expect(pro.getByText("€49.00/month")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// A publishable key used from a page its owner did not allow: the read answers 403
// `PublicAuth.OriginNotAllowed`.
// ---------------------------------------------------------------------------

test("a catalogue refused for its origin shows an error with a retry, not an empty shop", async () => {
  stubCatalogApi(originNotAllowed);
  const { container } = renderTable();

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Failed to load");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(cards()).toHaveLength(0);
  expect(container.querySelector('[data-slot="section-error"]')).not.toBeNull();
  // No price, no plan, and no loading placeholder left behind.
  expect(container.querySelector('[data-slot="pricing-table-loading"]')).toBeNull();
  expect(screen.queryByText("Select plan")).toBeNull();
});

test("the retry reads the catalogue again, and the table appears once the origin is allowed", async () => {
  let allowed = false;
  const { requests } = stubCatalogApi(() => (allowed ? {} : originNotAllowed));
  renderTable();
  await screen.findByRole("alert");
  expect(requests).toHaveLength(1);

  // Refused again: the error stays, and so does the way to try once more.
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();

  allowed = true;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(within(await card("Pro")).getByText("€49.00")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(requests).toHaveLength(3);
});

test("the error is the API's, with its status and code, for a host that reads usePlans", async () => {
  stubCatalogApi(originNotAllowed);
  let seen: Error | null = null;
  function Probe() {
    seen = usePlans().error;
    return null;
  }
  render(
    <KaitenProvider
      mode="public"
      apiUrl={API}
      publishableKey={freshPublishableKey()}
      polling={{ enabled: false }}
    >
      <Probe />
    </KaitenProvider>,
  );

  await waitFor(() => expect(seen).not.toBeNull());
  expect(seen).toBeInstanceOf(KaitenError);
  expect(seen).toMatchObject({ status: 403, code: "PublicAuth.OriginNotAllowed" });
  // A refusal to wait out is not what this is: nothing is asked to be tried later.
  expect((seen as unknown as KaitenError).retryAfterSeconds).toBeUndefined();
});

test("unstyled, and in French, the same error and the same retry", async () => {
  stubCatalogApi(originNotAllowed);
  const { container } = renderTable({ unstyled: true }, { locale: fr });

  expect((await screen.findByRole("alert")).textContent).toBe("Échec du chargement");
  expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  expect(container.querySelector('[data-slot="section-error"]')).not.toBeNull();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
});
