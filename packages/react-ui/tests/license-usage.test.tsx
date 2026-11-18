// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// `LicenseUsage`: the licence a customer holds and what it has used. Each test builds its entitlements
// the way the product does: with the client's own normalizer for a licensing snapshot
// (`mode="authenticated"`), and through the real session client from the answers Kaiten recorded for
// Initech for a customer session, so the rows are what the client makes of real figures.

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";

vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

import { normalizeResolvedEntitlements, type EntitlementUsage } from "@kaitencloud/client";
import { de, es, fr } from "@kaitencloud/react/locales";
import { useLicensingSnapshot } from "@kaitencloud/react";
import type {
  KaitenLocalizationOverrides,
  License,
  LicenseTerm,
  LicensingSnapshot,
} from "@kaitencloud/react";

import { LicenseUsage, formatKaitenDate } from "../src/index.ts";
import { sessionServer } from "../.storybook/session-server.ts";
import { mount as mountSession } from "./support/session-mount.tsx";
import { KaitenProvider } from "./support/styled-provider.tsx";

import answers from "../../client/tests/fixtures/session.initech.json" with { type: "json" };

/** A numeric quota of the licence: what it grants, what is consumed, what it tolerates. */
interface Quota {
  slug: string;
  name: string;
  /** The granted value; `-1` is the unlimited sentinel. */
  limit: number;
  used: number;
  /** How far past `limit` usage is still accepted, as a percentage of it. */
  allowance?: number;
  /** The unit it is counted in, singular and plural. */
  unit?: [string, string];
  /** The bounds of the window it is counted in; a lifetime counter has none. */
  window?: [string, string];
  /** `false` is an internal counter. */
  userFacing?: boolean;
}

interface Flag {
  slug: string;
  name: string;
  value: boolean;
}

const LICENSE: License = {
  id: "lic-1",
  slug: "enterprise",
  name: "Kaiten Enterprise",
  description: "The licence",
  type: "PAID",
  version: "1.0.0",
  lifecycleState: "PUBLISHED",
  familyId: "fam-1",
  isDefault: true,
};

const TERM: LicenseTerm = { status: "active", startsAt: "2026-01-01", expiresAt: "2026-12-31" };

/** A snapshot whose entitlements are what the client makes of these grants and this usage. */
function snapshotOf(
  grants: Array<Quota | Flag>,
  options: {
    usageUnavailable?: boolean;
    license?: Partial<License>;
    licenseTerm?: LicenseTerm | null;
    /**
     * Quotas the licence does not grant and an attached add-on does. The usage read is the instance's
     * effective set: it has a row for each, naming the layer, and no grant of the licence behind it.
     */
    addOnQuotas?: Quota[];
  } = {},
): LicensingSnapshot {
  const license = { ...LICENSE, ...options.license };
  const rows = grants.map((grant) =>
    "limit" in grant
      ? {
          entitlementSlug: grant.slug,
          entitlementName: grant.name,
          entitlementType: "NUMBER",
          licenseSlug: license.slug,
          value: { type: "number" as const, value: grant.limit },
          limitCapExceededOveragePercent: grant.limit === -1 ? -1 : (grant.allowance ?? 0),
          entitlement: {
            slug: grant.slug,
            name: grant.name,
            unitSingular: grant.unit?.[0],
            unitPlural: grant.unit?.[1],
            userFacing: grant.userFacing,
          },
        }
      : {
          entitlementSlug: grant.slug,
          entitlementName: grant.name,
          entitlementType: "BOOLEAN",
          licenseSlug: license.slug,
          value: { type: "boolean" as const, value: grant.value },
        },
  );
  const usage = grants.flatMap((grant): EntitlementUsage[] =>
    "limit" in grant
      ? [
          {
            entitlementId: `e-${grant.slug}`,
            entitlementSlug: grant.slug,
            licenseId: license.id,
            licenseSlug: license.slug,
            value: { type: "number", value: grant.used },
            currentPeriodStart: grant.window?.[0],
            currentPeriodEnd: grant.window?.[1],
          },
        ]
      : [],
  );
  const addOnQuotas = options.addOnQuotas ?? [];
  const addOnUsage = addOnQuotas.map((quota): EntitlementUsage => ({
    entitlementId: `e-${quota.slug}`,
    entitlementSlug: quota.slug,
    licenseId: license.id,
    licenseSlug: license.slug,
    value: { type: "number", value: quota.used },
    limit: { type: "number", value: quota.limit },
    source: "addon",
  }));
  // The name and the unit of what only an add-on grants come from the definition another licence of the
  // catalog carries: the client reads these rows for that and for nothing else.
  const definitions = addOnQuotas.map((quota) => ({
    entitlementSlug: quota.slug,
    entitlementName: quota.name,
    entitlementType: "NUMBER",
    licenseSlug: "other",
    value: { type: "number" as const, value: 0 },
    entitlement: {
      slug: quota.slug,
      name: quota.name,
      unitSingular: quota.unit?.[0],
      unitPlural: quota.unit?.[1],
    },
  }));

  return {
    source: "snapshot",
    customer: null,
    instance: null,
    license,
    licenseTerm: options.licenseTerm === undefined ? TERM : options.licenseTerm,
    plans: [],
    addOns: [],
    credits: [],
    entitlements: normalizeResolvedEntitlements(rows, [...usage, ...addOnUsage], {
      usageUnavailable: options.usageUnavailable,
      definitions,
    }),
    flags: [],
    actions: [],
    capabilities: { paymentMethods: false, invoices: false, unsubscribe: false, checkout: false },
    branding: { removable: false },
  } as unknown as LicensingSnapshot;
}

function install(grants: Array<Quota | Flag>, options?: Parameters<typeof snapshotOf>[1]) {
  kaitenClientMock.state.snapshot = snapshotOf(grants, options);
  kaitenClientMock.state.catalog = { plans: [], branding: { removable: false } };
}

// Each mount gets its own customer id: SWR keys its cache on the provider's scope, so two mounts that
// share one would serve the first one's snapshot to the second.
let scope = 0;
function mount(ui: React.ReactNode, locale?: KaitenLocalizationOverrides) {
  scope += 1;
  return render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={`cus_license_usage_${scope}`}
      polling={{ enabled: false }}
      locale={locale}
    >
      {ui}
    </KaitenProvider>,
  );
}

async function settled() {
  await waitFor(() => {
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  kaitenClientMock.resetScopes();
});

/** The usage of one quota could not be read, as a customer session reports it. */
function failUsageOf(slug: string) {
  const entitlement = (kaitenClientMock.state.snapshot as LicensingSnapshot).entitlements.find(
    (each) => each.slug === slug,
  )!;
  entitlement.currentValue = null;
  entitlement.usageUnavailable = true;
}

const block = () => document.querySelector<HTMLElement>('[data-slot="license-usage"]');
const rows = () => [...document.querySelectorAll<HTMLElement>('[data-slot="license-usage-quota"]')];
const rowOf = (name: string) => rows().find((row) => row.textContent?.startsWith(name))!;
const bars = () => screen.queryAllByRole("progressbar");
const barNamed = (name: string) => screen.getByRole("progressbar", { name });
const segment = (bar: HTMLElement, name: string) =>
  bar.querySelector<HTMLElement>(`[data-segment="${name}"]`);

// --- A capped quota --------------------------------------------------------------------------

test("a capped quota has its figures, its unit, a percentage and a bar named by them", async () => {
  install([
    {
      slug: "api_calls",
      name: "API calls",
      limit: 200_000,
      used: 30_000,
      unit: ["call", "calls"],
      window: ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"],
    },
  ]);
  mount(<LicenseUsage />);
  await settled();

  const row = rowOf("API calls");
  expect(within(row).getByText("30,000 / 200,000 calls")).toBeDefined();
  expect(within(row).getByText("15%")).toBeDefined();
  // The window the counter is read in is said on the row, as the meters say it.
  expect(within(row).getByText(/^This period: /)).toBeDefined();
  const bar = barNamed("API calls: 30,000 / 200,000");
  expect(bar.dataset.usageState).toBe("healthy");
  expect(bar.getAttribute("aria-valuenow")).toBe("30000");
  expect(bar.getAttribute("aria-valuemax")).toBe("200000");
  expect(row.dataset.usageState).toBe("healthy");
  // The row has no word of an unlimited grant, and the usage is read: nothing is unavailable.
  expect(within(row).queryByText(/Unlimited/)).toBeNull();
  expect(row.querySelector('[data-slot="license-usage-unavailable"]')).toBeNull();
});

test("a lifetime counter says so", async () => {
  install([{ slug: "projects", name: "Projects", limit: 50, used: 10 }]);
  mount(<LicenseUsage />);
  await settled();

  expect(within(rowOf("Projects")).getByText("All time")).toBeDefined();
});

test("the figures ride the bar's name and are not read out a second time", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(<LicenseUsage />);
  await settled();

  expect(screen.getByText("5 / 25").getAttribute("aria-hidden")).toBe("true");
  expect(barNamed("Seats: 5 / 25")).toBeDefined();
});

// --- The usage rule: soft limit, near limit, over limit --------------------------------------

test("a soft limit draws its allowance as a band and marks the granted value", async () => {
  install([{ slug: "projects", name: "Projects", limit: 100, used: 60, allowance: 25 }]);
  mount(<LicenseUsage />);
  await settled();

  // The track runs to the ceiling the API accepts, 125, and 60 of it is healthy.
  const bar = barNamed("Projects: 60 / 100");
  expect(bar.getAttribute("aria-valuemax")).toBe("125");
  expect(bar.dataset.usageState).toBe("healthy");
  expect(segment(bar, "band")).not.toBeNull();
  expect(segment(bar, "grant")).not.toBeNull();
  expect(within(rowOf("Projects")).getByText("60%")).toBeDefined();
});

test("a quota is amber near its limit, amber inside its allowance, and red on the wall and past it", async () => {
  install([
    { slug: "atlas", name: "Atlas", limit: 100, used: 85 },
    { slug: "borealis", name: "Borealis", limit: 100, used: 110, allowance: 20 },
    { slug: "cirrus", name: "Cirrus", limit: 100, used: 120, allowance: 20 },
    { slug: "delta", name: "Delta", limit: 100, used: 130, allowance: 20 },
  ]);
  mount(<LicenseUsage />);
  await settled();

  expect(barNamed("Atlas: 85 / 100").dataset.usageState).toBe("near_limit");
  expect(barNamed("Borealis: 110 / 100").dataset.usageState).toBe("in_allowance");
  expect(barNamed("Cirrus: 120 / 100").dataset.usageState).toBe("at_limit");
  expect(barNamed("Delta: 130 / 100").dataset.usageState).toBe("over_limit");

  // The badge follows the shared rule: the percentage is of the granted value, and is not capped.
  const badge = (row: string, text: string) => within(rowOf(row)).getByText(text);
  expect(badge("Atlas", "85%").className).toContain("text-warning-subtle-foreground");
  expect(badge("Borealis", "110%").className).toContain("border-warning-subtle-foreground/40");
  expect(badge("Cirrus", "120%").className).toContain("bg-destructive");
  expect(badge("Delta", "130%").className).toContain("bg-destructive");
});

test("a quota in its watch band keeps the green badge the meters give it", async () => {
  // 85 of a granted 100 is a watch once a 50% allowance is counted.
  install([{ slug: "atlas", name: "Atlas", limit: 100, used: 85, allowance: 50 }]);
  mount(<LicenseUsage />);
  await settled();

  expect(barNamed("Atlas: 85 / 100").dataset.usageState).toBe("watch");
  expect(within(rowOf("Atlas")).getByText("85%").className).toContain("ktn-badge-success");
});

// --- An unlimited quota ----------------------------------------------------------------------

test('an unlimited quota has what is used out of "Unlimited", with no percentage or bar', async () => {
  install([
    { slug: "seats", name: "Seats", limit: -1, used: 12, unit: ["seat", "seats"] },
    { slug: "webhooks", name: "Webhooks", limit: -1, used: 1, unit: ["webhook", "webhooks"] },
  ]);
  mount(<LicenseUsage />);
  await settled();

  const seats = rowOf("Seats");
  expect(within(seats).getByText("12 seats / Unlimited")).toBeDefined();
  // The unit follows the count it is said of.
  expect(within(rowOf("Webhooks")).getByText("1 webhook / Unlimited")).toBeDefined();
  // The word is said once, in the figures: no mark beside them says it again.
  expect(within(seats).queryByRole("img")).toBeNull();
  expect(seats.dataset.usageState).toBe("unbounded");
  expect(within(seats).queryByText(/%/)).toBeNull();
  expect(bars()).toHaveLength(0);
  // What is used is read out: there is no bar to carry it.
  expect(within(seats).getByText("12 seats / Unlimited").getAttribute("aria-hidden")).toBeNull();
});

test('an unlimited quota says its window when it resets, and never "All time"', async () => {
  install([
    { slug: "customers", name: "Customers", limit: -1, used: 187 },
    {
      slug: "webhooks",
      name: "Webhooks",
      limit: -1,
      used: 4_200,
      window: ["2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"],
    },
  ]);
  mount(<LicenseUsage />);
  await settled();

  // Beside a cap, "All time" says the counter never resets. Beside none it says nothing.
  expect(within(rowOf("Customers")).queryByText("All time")).toBeNull();
  // A counter that resets still says what the figure counts.
  expect(within(rowOf("Webhooks")).getByText(/^This period: /)).toBeDefined();
});

test("the server's unlimited flag decides, not the raw sentinel", async () => {
  // A negative grant that is enforced stays a quota with a cap, as the meters read it.
  kaitenClientMock.state.snapshot = snapshotOf([
    { slug: "api_calls", name: "API calls", limit: -1, used: 4_200 },
  ]);
  const snapshot = kaitenClientMock.state.snapshot as LicensingSnapshot;
  snapshot.entitlements[0]!.unlimited = false;
  snapshot.entitlements[0]!.limitValue = { type: "number", value: 500 };
  kaitenClientMock.state.catalog = { plans: [], branding: { removable: false } };
  mount(<LicenseUsage />);
  await settled();

  expect(within(rowOf("API calls")).queryByText(/Unlimited/)).toBeNull();
  expect(barNamed("API calls: 4,200 / 500")).toBeDefined();
});

test("capped and unlimited quotas share a block, in the order they come", async () => {
  install([
    { slug: "api_calls", name: "API calls", limit: 1_000, used: 250 },
    { slug: "seats", name: "Seats", limit: -1, used: 12 },
    { slug: "storage", name: "Storage", limit: 20, used: 3 },
  ]);
  mount(<LicenseUsage />);
  await settled();

  // The entitlements arrive sorted by the client: display order, then name.
  expect(rows().map((row) => row.querySelector("p")?.textContent)).toEqual([
    "API calls",
    "Seats",
    "Storage",
  ]);
  expect(rows().map((row) => row.dataset.usageState)).toEqual(["healthy", "unbounded", "healthy"]);
  expect(bars()).toHaveLength(2);
  expect(screen.getAllByText(/ \/ Unlimited$/)).toHaveLength(1);
});

// --- A usage that could not be read ----------------------------------------------------------

test("a quota whose usage could not be read says so, in place of figures, a percentage and a bar", async () => {
  install(
    [
      { slug: "api_calls", name: "API calls", limit: 100, used: 100 },
      { slug: "seats", name: "Seats", limit: -1, used: 12 },
    ],
    { usageUnavailable: true },
  );
  mount(<LicenseUsage />);
  await settled();

  expect(document.querySelectorAll('[data-slot="license-usage-unavailable"]')).toHaveLength(2);
  expect(within(rowOf("API calls")).getByText("Usage unavailable")).toBeDefined();
  expect(screen.queryByText(/^0 \//)).toBeNull();
  expect(screen.queryByText("0%")).toBeNull();
  expect(bars()).toHaveLength(0);
  // The grant is known to be unlimited, whatever the read said.
  expect(within(rowOf("Seats")).getByText("Usage unavailable / Unlimited")).toBeDefined();
  // And the row has no state to be in.
  expect(rowOf("API calls").hasAttribute("data-usage-state")).toBe(false);
});

// --- What the block lists --------------------------------------------------------------------

test("only numeric quotas the customer is meant to see are listed", async () => {
  install([
    { slug: "api_calls", name: "API calls", limit: 100, used: 10 },
    { slug: "internal_ops", name: "Internal ops", limit: 10, used: 3, userFacing: false },
    { slug: "sso", name: "Single sign-on", value: true },
  ]);
  mount(<LicenseUsage />);
  await settled();

  expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining("API calls")]);
  expect(screen.queryByText("Internal ops")).toBeNull();
  expect(screen.queryByText("Single sign-on")).toBeNull();
});

test("a licence with no numeric quota says so in a sentence, and is not an empty block", async () => {
  install([{ slug: "sso", name: "Single sign-on", value: true }]);
  mount(<LicenseUsage />);
  await settled();

  expect(block()).not.toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Kaiten Enterprise" })).toBeDefined();
  expect(document.querySelector('[data-slot="license-usage-empty"]')?.textContent).toBe(
    "No metered quota on this plan.",
  );
  expect(screen.queryByRole("list")).toBeNull();
});

test("a provenance note says where a limit comes from", async () => {
  mountSession(sessionServer(), <LicenseUsage />);
  await screen.findByText("API calls");

  fireEvent.click(screen.getByRole("button", { name: "How this limit is made up: API calls" }));
  expect(screen.getByRole("note").textContent).toBe(
    "Source: Current plan. (100,000 base) × 2 voucher = 200,000",
  );
});

test("a quota only an add-on grants is listed beside the licence's own, and says where it comes from", async () => {
  // The snapshot is the instance's effective set: the seats come from the licence, the extra webhooks
  // only from an attached add-on, which a walk of the licence's own grants would never have listed.
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }], {
    addOnQuotas: [
      {
        slug: "extra_webhooks",
        name: "Extra webhooks",
        limit: 10,
        used: 4,
        unit: ["webhook", "webhooks"],
      },
    ],
  });
  mount(<LicenseUsage />);
  await settled();

  expect(rows().map((row) => row.querySelector("p")?.textContent)).toEqual([
    "Extra webhooks",
    "Seats",
  ]);
  const row = rowOf("Extra webhooks");
  expect(within(row).getByText("4 / 10 webhooks")).toBeDefined();
  expect(barNamed("Extra webhooks: 4 / 10").dataset.usageState).toBe("healthy");
  fireEvent.click(
    within(row).getByRole("button", { name: "How this limit is made up: Extra webhooks" }),
  );
  expect(within(row).getByRole("note").textContent).toBe("Source: add-on.");
  // The licence's own quota has no such note: nothing but the licence sets it.
  expect(within(rowOf("Seats")).queryByRole("button")).toBeNull();
});

// --- The licence -----------------------------------------------------------------------------

test("it is a region named by the licence, with a level 2 heading and a list of its quotas", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(<LicenseUsage />);
  await settled();

  const heading = screen.getByRole("heading", { level: 2, name: "Kaiten Enterprise" });
  expect(screen.getByRole("region", { name: "Kaiten Enterprise" })).toBe(block());
  expect(block()?.contains(heading)).toBe(true);
  // The list is named by what is on screen above it, and that says what the figures are.
  const list = screen.getByRole("list", { name: "Usage" });
  expect(document.querySelector('[data-slot="license-usage-label"]')?.textContent).toBe("Usage");
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
});

test("the term is said when the snapshot has one", async () => {
  const cases: Array<[LicenseTerm, string]> = [
    [TERM, `Renews ${formatKaitenDate("2026-12-31")}`],
    [{ ...TERM, status: "expired" }, `Expired ${formatKaitenDate("2026-12-31")}`],
    [{ ...TERM, status: "not_started" }, `Starts ${formatKaitenDate("2026-01-01")}`],
  ];
  for (const [licenseTerm, sentence] of cases) {
    install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }], { licenseTerm });
    mount(<LicenseUsage />);
    await settled();
    expect(
      document.querySelector('[data-slot="license-usage-term"]')?.textContent,
      licenseTerm.status,
    ).toBe(sentence);
    cleanup();
  }

  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }], { licenseTerm: null });
  mount(<LicenseUsage />);
  await settled();
  expect(document.querySelector('[data-slot="license-usage-term"]')).toBeNull();
});

test("a trial licence wears a trial badge, and a paid one does not", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }], { license: { type: "TRIAL" } });
  mount(<LicenseUsage />);
  await settled();
  expect(document.querySelector('[data-slot="license-usage-trial"]')?.textContent).toBe("Trial");
  // The badge is not part of the name the region is called by.
  expect(screen.getByRole("region", { name: "Kaiten Enterprise" })).toBeDefined();
  cleanup();

  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(<LicenseUsage />);
  await settled();
  expect(document.querySelector('[data-slot="license-usage-trial"]')).toBeNull();
});

// --- The states ------------------------------------------------------------------------------

test("it shows a skeleton while the snapshot loads", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  kaitenClientMock.getLicensingSnapshot.mockImplementationOnce(() => new Promise(() => {}));
  mount(<LicenseUsage />);

  await waitFor(() => {
    expect(document.querySelector('[data-slot="license-usage-loading"]')).not.toBeNull();
  });
  expect(
    document.querySelector('[data-slot="license-usage-loading"]')?.getAttribute("aria-busy"),
  ).toBe("true");
  expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  expect(block()).toBeNull();
});

test("it shows an error with a retry, never a blank, when the snapshot fails", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));
  mount(<LicenseUsage />);

  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.getByText("Failed to load")).toBeDefined();
  expect(block()).toBeNull();

  // Only the first read fails: the retry recovers.
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
  expect(rowOf("Seats")).toBeDefined();
});

test("a read that fails after the licence was read keeps the licence on screen, and no alert", async () => {
  // The provider holds what the last good read said while it reads again, with the failure beside it:
  // a customer who has their licence in front of them is not handed an error in its place. The error
  // card is for a read that never had data (the test above).
  function Reread() {
    const { error, refetch } = useLicensingSnapshot();
    return (
      <>
        <p>{error ? "the last read failed" : "the last read held"}</p>
        <button type="button" onClick={() => refetch()}>
          Read again
        </button>
      </>
    );
  }
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(
    <>
      <LicenseUsage />
      <Reread />
    </>,
  );
  await screen.findByRole("heading", { level: 2, name: "Kaiten Enterprise" });
  expect(screen.getByText("the last read held")).toBeDefined();

  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));
  fireEvent.click(screen.getByRole("button", { name: "Read again" }));
  await screen.findByText("the last read failed");

  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Kaiten Enterprise" })).toBeDefined();
  expect(rowOf("Seats")).toBeDefined();
});

test("every root it draws is the SDK's own, in each state, styled or not", async () => {
  // The stylesheet applies to the markup the SDK renders, and `ktn-own` is what says whose a root is:
  // a root without it keeps the browser's defaults and none of the SDK's utilities, and Storybook,
  // which renders the stylesheet before it is scoped, would not show it.
  const rootsOf = (container: HTMLElement) =>
    [...container.querySelector(".kaiten")!.children].filter(
      (child) => child.getAttribute("data-slot") !== "kaiten-portal-host",
    );
  const expectOwned = (container: HTMLElement, slot: string) => {
    const roots = rootsOf(container);
    expect(roots, slot).toHaveLength(1);
    expect(roots[0]!.getAttribute("data-slot"), slot).toBe(slot);
    expect(roots[0]!.classList.contains("ktn-own"), slot).toBe(true);
  };

  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  const styled = mount(<LicenseUsage />);
  await settled();
  expectOwned(styled.container, "license-usage");
  styled.unmount();

  const unstyled = mount(<LicenseUsage unstyled />);
  await settled();
  expectOwned(unstyled.container, "license-usage");
  unstyled.unmount();

  kaitenClientMock.getLicensingSnapshot.mockImplementationOnce(() => new Promise(() => {}));
  const loading = mount(<LicenseUsage />);
  await waitFor(() => {
    expect(loading.container.querySelector('[data-slot="license-usage-loading"]')).not.toBeNull();
  });
  expectOwned(loading.container, "license-usage-loading");
  loading.unmount();

  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));
  const failed = mount(<LicenseUsage />);
  await screen.findByRole("alert");
  expectOwned(failed.container, "section-error");
  failed.unmount();

  // Nothing of the block's own is left over once the provider has no snapshot to read.
  const nothing = render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <LicenseUsage />
    </KaitenProvider>,
  );
  expect(rootsOf(nothing.container)).toEqual([]);
});

test("it draws nothing where there is no snapshot to read: public and static", async () => {
  kaitenClientMock.state.catalog = { plans: [], branding: { removable: false } };
  const { container, unmount } = render(
    <KaitenProvider mode="public" publishableKey="pk_demo" polling={{ enabled: false }}>
      <LicenseUsage />
    </KaitenProvider>,
  );
  await settled();
  expect(container.querySelector('[data-slot="license-usage"]')).toBeNull();
  expect(container.querySelector('[data-slot="section-error"]')).toBeNull();
  unmount();

  const fixed = render(
    <KaitenProvider mode="static" catalog={{ plans: [] }}>
      <LicenseUsage />
    </KaitenProvider>,
  );
  expect(fixed.container.querySelector('[data-slot="license-usage"]')).toBeNull();
  expect(fixed.container.querySelector('[data-slot="license-usage-loading"]')).toBeNull();
});

// --- Unstyled --------------------------------------------------------------------------------

test("unstyled, the rows are plain text, keep their hooks, and say what a bar would", async () => {
  install(
    [
      {
        slug: "api_calls",
        name: "API calls",
        limit: 200_000,
        used: 30_000,
        unit: ["call", "calls"],
      },
      { slug: "seats", name: "Seats", limit: -1, used: 12, unit: ["seat", "seats"] },
    ],
    { license: { type: "TRIAL" } },
  );
  mount(<LicenseUsage unstyled />);
  await settled();

  expect(screen.getByRole("heading", { level: 2, name: "Kaiten Enterprise" })).toBeDefined();
  expect(document.querySelector('[data-slot="license-usage-trial"]')?.textContent).toBe("Trial");
  expect(document.querySelector('[data-slot="license-usage-term"]')).not.toBeNull();
  expect(rowOf("API calls").textContent).toContain("API calls: 30,000 / 200,000 calls");
  expect(rowOf("Seats").textContent).toContain("Seats: 12 seats / Unlimited");
  expect(bars()).toHaveLength(0);
  expect(document.querySelector('[data-slot="card"]')).toBeNull();
  expect(document.querySelector('[data-slot="progress-bar"]')).toBeNull();
});

test("unstyled, a failed read is not a quantity, and an empty licence says so", async () => {
  install([{ slug: "api_calls", name: "API calls", limit: 100, used: 100 }], {
    usageUnavailable: true,
  });
  mount(<LicenseUsage unstyled />);
  await settled();
  expect(rowOf("API calls").textContent).toContain("API calls: Usage unavailable");
  expect(rowOf("API calls").textContent).not.toMatch(/0 \/ 100/);
  cleanup();

  install([]);
  mount(<LicenseUsage unstyled />);
  await settled();
  expect(document.querySelector('[data-slot="license-usage-empty"]')?.textContent).toBe(
    "No metered quota on this plan.",
  );
});

test("unstyled, the loading and failed states are the shared ones", async () => {
  install([]);
  kaitenClientMock.getLicensingSnapshot.mockRejectedValueOnce(new Error("backend down"));
  mount(<LicenseUsage unstyled />);

  expect(await screen.findByRole("alert")).toBeDefined();
  expect(document.querySelector('[data-slot="section-error"]')).not.toBeNull();
  expect(document.querySelector('[data-slot="card"]')).toBeNull();
});

// --- Appearance ------------------------------------------------------------------------------

test("the appearance's classes reach the card and the bars", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(
    <LicenseUsage
      appearance={{
        elements: {
          card: "host-card",
          cardHeader: "host-card-header",
          cardTitle: "host-card-title",
          cardContent: "host-card-content",
          usageBar: "host-bar",
          usageBarFill: "host-bar-fill",
        },
      }}
    />,
  );
  await settled();

  const sel = (selector: string) => block()?.querySelector(selector);
  expect(sel('[data-slot="card"]')?.className).toContain("host-card");
  expect(sel('[data-slot="card-header"]')?.className).toContain("host-card-header");
  expect(sel('[data-slot="card-title"]')?.className).toContain("host-card-title");
  expect(sel('[data-slot="card-content"]')?.className).toContain("host-card-content");
  expect(sel('[data-slot="progress-bar"]')?.className).toContain("host-bar");
  expect(sel('[data-slot="progress-bar-fill"]')?.className).toContain("host-bar-fill");
});

// --- Language --------------------------------------------------------------------------------

test("the words are the pack's: French, Spanish and German", async () => {
  for (const [pack, words] of [
    [
      fr,
      {
        unlimited: "Illimité",
        unavailable: "Consommation indisponible",
        trial: "Essai",
        list: "Usage",
        empty: "Aucun quota mesuré sur cette offre.",
      },
    ],
    [
      es,
      {
        unlimited: "Ilimitado",
        unavailable: "Uso no disponible",
        trial: "Prueba",
        list: "Uso",
        empty: "Ningún cupo medido en este plan.",
      },
    ],
    [
      de,
      {
        unlimited: "Unbegrenzt",
        unavailable: "Nutzung nicht verfügbar",
        trial: "Testphase",
        list: "Nutzung",
        empty: "Kein gemessenes Kontingent in diesem Tarif.",
      },
    ],
  ] as const) {
    install(
      [
        { slug: "seats", name: "Seats", limit: -1, used: 12 },
        { slug: "api_calls", name: "API calls", limit: 100, used: 100 },
      ],
      { license: { type: "TRIAL" } },
    );
    // The usage of one quota could not be read: said in the pack's words too.
    failUsageOf("api_calls");
    mount(<LicenseUsage />, pack);
    await settled();

    expect(within(rowOf("Seats")).getByText(`12 / ${words.unlimited}`)).toBeDefined();
    expect(within(rowOf("API calls")).getByText(words.unavailable)).toBeDefined();
    expect(document.querySelector('[data-slot="license-usage-trial"]')?.textContent).toBe(
      words.trial,
    );
    expect(screen.getByRole("list", { name: words.list })).toBeDefined();
    cleanup();

    install([{ slug: "sso", name: "SSO", value: true }]);
    mount(<LicenseUsage />, pack);
    await settled();
    expect(document.querySelector('[data-slot="license-usage-empty"]')?.textContent).toBe(
      words.empty,
    );
    cleanup();
  }
});

test("the term is said in French with the pack's date format", async () => {
  install([{ slug: "seats", name: "Seats", limit: 25, used: 5 }]);
  mount(<LicenseUsage />, fr);
  await settled();

  expect(document.querySelector('[data-slot="license-usage-term"]')?.textContent).toMatch(
    /^Renouvellement le /,
  );
});

// --- A customer session ----------------------------------------------------------------------

/** The recorded portal of Initech, changed the way a test says. */
function portalChanged(change: (portal: Record<string, any>) => void): Record<string, any> {
  const portal: Record<string, any> = structuredClone(answers.portal);
  change(portal);
  return portal;
}

test("a customer session draws the plan its portal names and the quotas it measured", async () => {
  mountSession(sessionServer(), <LicenseUsage />);

  // No licence in a session: the heading is the plan the portal names.
  expect(await screen.findByRole("heading", { level: 2, name: "Pro" })).toBeDefined();
  expect(screen.getByRole("region", { name: "Pro" })).toBe(block());
  // And no term: the portal carries none, and none is made up.
  expect(document.querySelector('[data-slot="license-usage-term"]')).toBeNull();
  expect(document.querySelector('[data-slot="license-usage-trial"]')).toBeNull();

  // The recorded portal: three capped quotas, one unlimited quota with its usage, and three grants
  // that are not quotas at all.
  expect(rows().map((row) => row.querySelector("p")?.textContent)).toEqual([
    "AI credits",
    "API calls",
    "Seats",
    "Workspaces",
  ]);
  expect(screen.queryByText("Single sign-on")).toBeNull();
  expect(screen.queryByText("Branding")).toBeNull();
  expect(screen.queryByText("Priority support")).toBeNull();

  // The soft limit of the API calls: 30,000 of 200,000, a ceiling of 240,000.
  const calls = barNamed("API calls: 30,000 / 200,000");
  expect(calls.getAttribute("aria-valuemax")).toBe("240000");
  expect(within(rowOf("API calls")).getByText(/^This period: /)).toBeDefined();
  // The seats are used up, and nothing is left to tolerate.
  expect(barNamed("Seats: 8 / 8").dataset.usageState).toBe("at_limit");
  // The unlimited workspaces: 12 used, no ratio.
  const workspaces = rowOf("Workspaces");
  expect(within(workspaces).getByText("12 / Unlimited")).toBeDefined();
  expect(bars()).toHaveLength(3);
});

test("a customer session in its trial wears the trial badge", async () => {
  mountSession(
    sessionServer({
      portal: portalChanged((portal) => {
        portal.subscription.status = "TRIAL";
        portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
      }),
    }),
    <LicenseUsage />,
  );

  await screen.findByRole("heading", { level: 2, name: "Pro" });
  expect(document.querySelector('[data-slot="license-usage-trial"]')?.textContent).toBe("Trial");
});

test("a customer session reads one quota at a time: the one without a usage says so", async () => {
  mountSession(
    sessionServer({
      portal: portalChanged((portal) => {
        portal.entitlements.find((each: any) => each.slug === "seats").currentValue = null;
      }),
    }),
    <LicenseUsage />,
  );

  await screen.findByText("Seats");
  expect(within(rowOf("Seats")).getByText("Usage unavailable")).toBeDefined();
  expect(screen.queryByRole("progressbar", { name: /^Seats:/ })).toBeNull();
  expect(barNamed("API calls: 30,000 / 200,000")).toBeDefined();
});

test("a customer session on a plan that grants no quota names the plan and says so", async () => {
  mountSession(sessionServer({ portal: "portalNeverSubscribed" }), <LicenseUsage />);

  expect(await screen.findByRole("heading", { level: 2, name: "Starter" })).toBeDefined();
  expect(document.querySelector('[data-slot="license-usage-empty"]')).not.toBeNull();
});

test("a session bound to the customer only has no plan to name, and is not blank either", async () => {
  mountSession(sessionServer({ portal: "portalCustomerWide" }), <LicenseUsage />);

  expect(await screen.findByRole("heading", { level: 2, name: "Usage meters" })).toBeDefined();
  expect(document.querySelector('[data-slot="license-usage-empty"]')).not.toBeNull();
});

test("a customer session whose portal cannot be read says so, and reads it again on request", async () => {
  const server = sessionServer();
  // A Kaiten that does not serve the portal answers 404; a 5xx would be read again by the client first.
  server.script("GET portal", {
    status: 404,
    body: { title: "Not Found", status: 404, detail: "GET portal" },
  });
  mountSession(server, <LicenseUsage />);

  expect(await screen.findByRole("alert")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Pro" })).toBeDefined();
  expect(server.to("GET", "portal")).toHaveLength(2);
});

test("a customer session says its words in French", async () => {
  mountSession(
    sessionServer({
      portal: portalChanged((portal) => {
        portal.subscription.status = "TRIAL";
        portal.subscription.trialEndsAt = "2026-11-01T00:00:00Z";
      }),
    }),
    <LicenseUsage />,
    fr,
  );

  await screen.findByRole("heading", { level: 2, name: "Pro" });
  expect(document.querySelector('[data-slot="license-usage-trial"]')?.textContent).toBe("Essai");
  expect(within(rowOf("Workspaces")).getByText("12 / Illimité")).toBeDefined();
  expect(screen.getByRole("list", { name: "Usage" })).toBeDefined();
});
