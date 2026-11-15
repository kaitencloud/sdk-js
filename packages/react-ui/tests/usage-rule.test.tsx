// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// What the styled components say of a quota follows the Kaiten console's rule, not the headless
// core's. The core's `status` counts from 80% of the granted value and ignores the allowance; the
// components below read the usage against the ceiling the grant permits (see usage-state.ts). Each
// test builds its entitlements with the client's own normalizer, so the core's reading is the one a
// host really gets, and the assertions show where the two differ.

import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";

vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

import { normalizeResolvedEntitlements, type EntitlementUsage } from "@kaitencloud/client";
import { de, es, fr } from "@kaitencloud/react/locales";
import type { KaitenLocalizationOverrides, LicensingSnapshot } from "@kaitencloud/react";

import {
  BillingSummary,
  EntitlementStatusBar,
  IncludedFeatures,
  Paywall,
  UsageMeters,
} from "../src/index.ts";
import { ProgressBar } from "../src/components/shared/progress-bar.tsx";
import { KaitenProvider } from "./support/styled-provider.tsx";

interface Quota {
  name: string;
  slug?: string;
  limit: number;
  used: number;
  allowance?: number;
}

const slugOf = (quota: Quota) => quota.slug ?? quota.name.toLowerCase().replace(/\W+/g, "_");

/** A snapshot whose entitlements are what the client makes of these quotas. */
function snapshotOf(quotas: Quota[], options: { usageUnavailable?: boolean } = {}) {
  const license = {
    id: "lic-1",
    slug: "pro",
    name: "Pro License",
    description: "Main license",
    type: "PAID" as const,
    version: "1.0.0",
    lifecycleState: "PUBLISHED" as const,
    familyId: "fam-1",
    isDefault: true,
  };
  const rows = quotas.map((quota) => ({
    entitlementSlug: slugOf(quota),
    entitlementName: quota.name,
    entitlementType: "NUMBER",
    licenseSlug: license.slug,
    value: { type: "number" as const, value: quota.limit },
    limitCapExceededOveragePercent: quota.limit === -1 ? -1 : (quota.allowance ?? 0),
  }));
  const usage = quotas.map((quota): EntitlementUsage => ({
    entitlementId: `e-${slugOf(quota)}`,
    entitlementSlug: slugOf(quota),
    licenseId: license.id,
    licenseSlug: license.slug,
    value: { type: "number", value: quota.used },
  }));

  return {
    source: "snapshot",
    customer: null,
    instance: null,
    license,
    licenseTerm: { status: "active", startsAt: "2026-01-01", expiresAt: "2026-12-31" },
    plans: [],
    addOns: [],
    credits: [],
    entitlements: normalizeResolvedEntitlements(rows, usage, options),
    flags: [],
    actions: [],
    capabilities: { paymentMethods: false, invoices: false, unsubscribe: false, checkout: false },
    branding: { removable: false },
  } as unknown as LicensingSnapshot;
}

function install(quotas: Quota[], options?: { usageUnavailable?: boolean }) {
  kaitenClientMock.state.snapshot = snapshotOf(quotas, options);
  kaitenClientMock.state.catalog = { plans: [], branding: { removable: false } };
}

// Each mount gets its own customer id: SWR keys its cache on the provider's scope, so two mounts
// that share one would serve the first one's snapshot to the second.
let scope = 0;
function mount(ui: React.ReactNode, locale?: KaitenLocalizationOverrides) {
  scope += 1;
  return render(
    <KaitenProvider
      mode="authenticated"
      accessToken="tmp_demo"
      customerId={`cus_usage_rule_${scope}`}
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

const bars = () => screen.queryAllByRole("progressbar");
const barNamed = (name: RegExp | string) => screen.getByRole("progressbar", { name });
const panel = () => document.querySelector<HTMLElement>('[data-slot="billing-summary-warning"]');
const segment = (bar: HTMLElement, name: string) =>
  bar.querySelector<HTMLElement>(`[data-segment="${name}"]`);
/** A style's percentage as a number: the widths are quotients, not round figures. */
const percent = (value: string | undefined) => Number.parseFloat(value ?? "NaN");

// --- ProgressBar -----------------------------------------------------------------------------

test("ProgressBar: a hard limit is a track to the grant, amber from 80% and red on the wall", () => {
  const { rerender } = render(<ProgressBar value={79} max={100} />);
  const bar = () => screen.getByRole("progressbar");

  expect(bar().dataset.usageState).toBe("watch");
  expect(segment(bar(), "contract")?.className).toContain("bg-ktn-success");
  expect(segment(bar(), "contract")?.style.width).toBe("79%");
  // No allowance: no band, no tick, and the grant is the end of the track.
  expect(segment(bar(), "band")).toBeNull();
  expect(segment(bar(), "grant")).toBeNull();
  expect(bar().getAttribute("aria-valuemax")).toBe("100");

  rerender(<ProgressBar value={80} max={100} />);
  expect(bar().dataset.usageState).toBe("near_limit");
  expect(segment(bar(), "contract")?.className).toContain("bg-ktn-warning");

  rerender(<ProgressBar value={100} max={100} />);
  expect(bar().dataset.usageState).toBe("at_limit");
  expect(segment(bar(), "contract")?.className).toContain("bg-ktn-destructive");
  expect(segment(bar(), "contract")?.style.width).toBe("100%");

  // Past the wall the bar stays on the track.
  rerender(<ProgressBar value={140} max={100} />);
  expect(bar().dataset.usageState).toBe("over_limit");
  expect(segment(bar(), "contract")?.style.width).toBe("100%");
  expect(segment(bar(), "allowance")).toBeNull();
});

test("ProgressBar: keeps the slots, the role and the accessible name it has always had", () => {
  const { rerender } = render(<ProgressBar value={1500} max={4000} />);
  const bar = screen.getByRole("progressbar");

  expect(bar.dataset.slot).toBe("progress-bar");
  expect(bar.getAttribute("aria-valuenow")).toBe("1500");
  expect(bar.getAttribute("aria-valuemin")).toBe("0");
  expect(bar.getAttribute("aria-valuemax")).toBe("4000");
  expect(bar.getAttribute("aria-label")).toBe("Progress: 1,500 of 4,000");
  expect(bar.querySelector('[data-slot="progress-bar-fill"]')).not.toBeNull();

  rerender(<ProgressBar value={1} max={4} aria-label="Seats: 1 / 4" fillClassName="custom-fill" />);
  expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("Seats: 1 / 4");
  expect(
    screen.getByRole("progressbar").querySelector('[data-slot="progress-bar-fill"]')?.className,
  ).toContain("custom-fill");

  // Named by another element, it takes no name of its own.
  rerender(<ProgressBar value={1} max={4} aria-labelledby="heading" />);
  expect(screen.getByRole("progressbar").hasAttribute("aria-label")).toBe(false);
});

test("ProgressBar: an allowance stretches the track to the ceiling and marks the grant", () => {
  render(<ProgressBar value={60} max={100} overagePercent={25} />);
  const bar = screen.getByRole("progressbar");

  // The track runs to 125, the part up to 100 is 80% of it, and 60 is 48%.
  expect(bar.getAttribute("aria-valuemax")).toBe("125");
  expect(bar.getAttribute("aria-valuenow")).toBe("60");
  expect(bar.dataset.usageState).toBe("healthy");
  expect(segment(bar, "contract")?.style.width).toBe("48%");
  expect(segment(bar, "band")?.style.left).toBe("80%");
  // The band is hatched in the warning colour.
  expect(segment(bar, "band")?.style.backgroundImage).toContain("repeating-linear-gradient");
  expect(segment(bar, "band")?.style.backgroundImage).toContain("var(--ktn-warning)");
  expect(segment(bar, "grant")?.style.left).toBe("calc(80% - 0.5px)");
  // Nothing past the grant yet.
  expect(segment(bar, "allowance")).toBeNull();
});

test("ProgressBar: inside the allowance the part up to the grant stays green and the overage is amber", () => {
  render(<ProgressBar value={110} max={100} overagePercent={20} />);
  const bar = screen.getByRole("progressbar");

  expect(bar.dataset.usageState).toBe("in_allowance");
  // 100 of 120 is the contract, 10 of 120 the allowance used.
  expect(segment(bar, "contract")?.className).toContain("bg-ktn-success");
  expect(percent(segment(bar, "contract")?.style.width)).toBeCloseTo((100 / 120) * 100, 6);
  expect(segment(bar, "allowance")?.className).toContain("bg-ktn-warning");
  expect(percent(segment(bar, "allowance")?.style.left)).toBeCloseTo((100 / 120) * 100, 6);
  expect(percent(segment(bar, "allowance")?.style.width)).toBeCloseTo((10 / 120) * 100, 6);
});

test("ProgressBar: on the ceiling and past it the whole fill is red", () => {
  const { rerender } = render(<ProgressBar value={120} max={100} overagePercent={20} />);
  let bar = screen.getByRole("progressbar");

  expect(bar.dataset.usageState).toBe("at_limit");
  expect(segment(bar, "contract")?.className).toContain("bg-ktn-destructive");
  expect(segment(bar, "allowance")?.className).toContain("bg-ktn-destructive");

  rerender(<ProgressBar value={500} max={100} overagePercent={20} />);
  bar = screen.getByRole("progressbar");
  expect(bar.dataset.usageState).toBe("over_limit");
  // Kept on the track.
  expect(percent(segment(bar, "allowance")?.style.width)).toBeCloseTo((20 / 120) * 100, 6);
});

test("ProgressBar: a grant of nothing has no band to draw, and an unlimited one no track to fill", () => {
  const { rerender } = render(<ProgressBar value={3} max={0} overagePercent={25} />);
  let bar = screen.getByRole("progressbar");
  expect(bar.dataset.usageState).toBe("over_limit");
  expect(segment(bar, "band")).toBeNull();
  expect(segment(bar, "contract")?.style.width).toBe("100%");

  rerender(<ProgressBar value={3} max={-1} />);
  bar = screen.getByRole("progressbar");
  expect(bar.dataset.usageState).toBe("unbounded");
  expect(segment(bar, "contract")?.style.width).toBe("0%");
});

// --- BillingSummary --------------------------------------------------------------------------

const seats: Quota = { name: "Seats", limit: 25, used: 5 };

test("BillingSummary: a healthy quota raises nothing", async () => {
  install([{ name: "API calls", limit: 10_000, used: 1_200 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^API calls:/).dataset.usageState).toBe("healthy");
  expect(panel()).toBeNull();
});

test("BillingSummary: from 80% of a hard limit, the panel says how near", async () => {
  install([{ name: "API calls", limit: 10_000, used: 8_000 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^API calls:/).dataset.usageState).toBe("near_limit");
  expect(screen.getByText("API calls is at 80% of its limit.")).toBeDefined();
  expect(panel()?.dataset.usageState).toBe("near_limit");
  expect(panel()?.className).toContain("bg-warning-subtle");
});

test("BillingSummary: near the ceiling of a soft limit, the sentence quotes the figure of its row", async () => {
  install([{ name: "Projects", limit: 100, used: 100, allowance: 25 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^Projects:/).dataset.usageState).toBe("near_limit");
  // The state is decided on the ceiling (100 of 125), the figure is the row's, of the grant.
  expect(screen.getByText("Projects is at 100% of its limit.")).toBeDefined();
  expect(screen.getByText(/100 \/ 100 \(100\s?%\)/)).toBeDefined();
});

test("BillingSummary: inside the allowance is amber, and the percentage of the grant is not capped", async () => {
  install([{ name: "Projects", limit: 100, used: 105, allowance: 50 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^Projects:/).dataset.usageState).toBe("in_allowance");
  expect(
    screen.getByText("Projects is past its included amount, within its allowance."),
  ).toBeDefined();
  expect(screen.getByText(/105 \/ 100 \(105\s?%\)/)).toBeDefined();
  expect(panel()?.dataset.usageState).toBe("in_allowance");
  expect(panel()?.className).toContain("bg-warning-subtle");
  expect(panel()?.className).not.toContain("bg-destructive-subtle");
});

test("BillingSummary: on the ceiling and past it the panel is red", async () => {
  install([{ name: "Projects", limit: 100, used: 120, allowance: 20 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^Projects:/).dataset.usageState).toBe("at_limit");
  expect(screen.getByText("Projects has reached its limit.")).toBeDefined();
  expect(panel()?.className).toContain("bg-destructive-subtle");
  expect(panel()?.className).toContain("text-destructive-subtle-foreground");

  cleanup();
  install([{ name: "Projects", limit: 100, used: 130, allowance: 20 }, seats]);
  mount(<BillingSummary />);
  await settled();

  expect(barNamed(/^Projects:/).dataset.usageState).toBe("over_limit");
  expect(screen.getByText("Projects is over its limit.")).toBeDefined();
  expect(panel()?.className).toContain("bg-destructive-subtle");
});

test("BillingSummary: of several quotas at risk, the most severe one speaks", async () => {
  // Sorted by name: API calls (near), Projects (healthy), Seats (in allowance), Storage (over).
  install([
    { name: "API calls", limit: 1_000, used: 850 },
    { name: "Seats", limit: 25, used: 26, allowance: 25 },
    { name: "Storage", limit: 100, used: 130, allowance: 20 },
    { name: "Projects", limit: 50, used: 10 },
  ]);
  mount(<BillingSummary />);
  await settled();

  expect(screen.getByText("Storage is over its limit.")).toBeDefined();
  expect(document.querySelectorAll('[data-slot="billing-summary-warning"]')).toHaveLength(1);
});

test("BillingSummary: the severity runs over limit, at limit, in allowance, near limit", async () => {
  const cases: Array<[Quota[], string]> = [
    [
      [
        { name: "A", limit: 100, used: 90 },
        { name: "B", limit: 100, used: 110, allowance: 20 },
        { name: "C", limit: 100, used: 120, allowance: 20 },
      ],
      "C has reached its limit.",
    ],
    [
      [
        { name: "A", limit: 100, used: 90 },
        { name: "B", limit: 100, used: 110, allowance: 20 },
      ],
      "B is past its included amount, within its allowance.",
    ],
  ];

  for (const [quotas, sentence] of cases) {
    install(quotas);
    mount(<BillingSummary />);
    await settled();
    expect(screen.getByText(sentence)).toBeDefined();
    cleanup();
  }
});

test("BillingSummary: among equals the first in display order speaks", async () => {
  install([
    { name: "Builds", limit: 100, used: 90 },
    { name: "Alerts", limit: 100, used: 85 },
  ]);
  mount(<BillingSummary />);
  await settled();

  // The entitlements come sorted by name: Alerts first.
  expect(screen.getByText("Alerts is at 85% of its limit.")).toBeDefined();
  expect(screen.queryByText(/^Builds is at/)).toBeNull();
});

test("BillingSummary: a quota past maxMeters shows no bar and raises no panel", async () => {
  install([
    { name: "A", limit: 100, used: 10 },
    { name: "B", limit: 100, used: 10 },
    { name: "C", limit: 100, used: 200 },
  ]);
  mount(<BillingSummary maxMeters={2} />);
  await settled();

  expect(bars()).toHaveLength(2);
  expect(panel()).toBeNull();
});

test("BillingSummary: a failed usage read says it is unavailable, and never raises the panel", async () => {
  install(
    [
      { name: "API calls", limit: 100, used: 100 },
      { name: "Seats", limit: 25, used: 25 },
    ],
    { usageUnavailable: true },
  );
  mount(<BillingSummary />);
  await settled();

  // The core marks the read; the row says so in place of "0 / 100" and a bar.
  expect(
    (kaitenClientMock.state.snapshot as LicensingSnapshot).entitlements.every(
      (entitlement) => entitlement.usageUnavailable === true,
    ),
  ).toBe(true);
  expect(document.querySelectorAll('[data-slot="billing-summary-unavailable"]')).toHaveLength(2);
  expect(bars()).toHaveLength(0);
  expect(screen.queryByText(/^0 \/ /)).toBeNull();
  expect(panel()).toBeNull();
});

test("BillingSummary: unstyled never claims a failed read used nothing", async () => {
  install([{ name: "API calls", limit: 100, used: 100 }], { usageUnavailable: true });
  mount(<BillingSummary unstyled />);
  await settled();

  const item = screen.getByText(/^API calls:/);
  expect(item.textContent).not.toMatch(/0 \/ 100/);
});

test("BillingSummary: unlimited quotas have no meter and no panel", async () => {
  install([
    { name: "API calls", limit: -1, used: 48_000 },
    { name: "Seats", limit: -1, used: 900 },
  ]);
  mount(<BillingSummary />);
  await settled();

  expect(screen.getByText("No metered quota on this plan.")).toBeDefined();
  expect(bars()).toHaveLength(0);
  expect(panel()).toBeNull();
});

test("BillingSummary: the sentences are said in the language of the pack", async () => {
  for (const [pack, sentence] of [
    [fr, "Projects a atteint sa limite."],
    [de, "Projects hat das Limit erreicht."],
    [es, "Projects ha alcanzado su límite."],
  ] as const) {
    install([{ name: "Projects", limit: 100, used: 120, allowance: 20 }]);
    mount(<BillingSummary />, pack);
    await settled();
    expect(screen.getByText(sentence)).toBeDefined();
    cleanup();
  }
});

// --- UsageMeters -----------------------------------------------------------------------------

test("UsageMeters: the bar has the allowance and the badge follows the shared rule, not the core's status", async () => {
  // The core calls 85 of a granted 100 `near_limit` (it counts from 80% of the grant). With a 50%
  // allowance the ceiling is 150, and 85 of it is a watch.
  install([{ name: "Projects", limit: 100, used: 85, allowance: 50 }]);
  expect((kaitenClientMock.state.snapshot as LicensingSnapshot).entitlements[0]?.status).toBe(
    "near_limit",
  );

  mount(<UsageMeters />);
  await settled();

  const bar = barNamed("Progress: 85 of 100");
  expect(bar.dataset.usageState).toBe("watch");
  expect(bar.getAttribute("aria-valuemax")).toBe("150");
  const badge = screen.getByText("85%");
  expect(badge.className).not.toContain("text-warning-subtle-foreground");
  expect(badge.className).toContain("ktn-badge-success");
});

test("UsageMeters: the badge of a quota inside its allowance is the console's amber outline", async () => {
  install([{ name: "Projects", limit: 100, used: 110, allowance: 20 }]);
  mount(<UsageMeters />);
  await settled();

  expect(barNamed("Progress: 110 of 100").dataset.usageState).toBe("in_allowance");
  const badge = screen.getByText("110%");
  expect(badge.className).toContain("text-warning-subtle-foreground");
  expect(badge.className).toContain("border-warning-subtle-foreground/40");
});

test("UsageMeters: the badge turns red on the wall and past it", async () => {
  install([
    { name: "Atlas", limit: 100, used: 100 },
    { name: "Borealis", limit: 100, used: 150, allowance: 20 },
  ]);
  mount(<UsageMeters />);
  await settled();

  expect(barNamed("Progress: 100 of 100").dataset.usageState).toBe("at_limit");
  expect(barNamed("Progress: 150 of 100").dataset.usageState).toBe("over_limit");
  expect(screen.getByText("100%").className).toContain("bg-destructive");
  expect(screen.getByText("150%").className).toContain("bg-destructive");
});

// --- EntitlementStatusBar --------------------------------------------------------------------

test("EntitlementStatusBar: the label takes the tone of the shared rule", async () => {
  install([
    { name: "Atlas", limit: 100, used: 10 },
    { name: "Borealis", limit: 100, used: 85 },
    { name: "Cirrus", limit: 100, used: 110, allowance: 20 },
    { name: "Delta", limit: 100, used: 120, allowance: 20 },
  ]);
  mount(<EntitlementStatusBar maxMeters={4} />);
  await settled();

  const label = (name: string) => screen.getByTitle(name);
  expect(label("Atlas").className).toContain("text-ktn-foreground");
  expect(label("Borealis").className).toContain("text-warning-subtle-foreground");
  // Inside the allowance: amber, where the old 100% cap would have read it red.
  expect(label("Cirrus").className).toContain("text-warning-subtle-foreground");
  expect(label("Delta").className).toContain("text-destructive-subtle-foreground");
  // The percentage is of the grant and no longer stops at 100.
  expect(screen.getByText("110%")).toBeDefined();
  expect(screen.getByText("120%")).toBeDefined();
  expect(barNamed("Cirrus: 110 / 100").dataset.usageState).toBe("in_allowance");
});

test("EntitlementStatusBar: a watch band quota keeps the plain label", async () => {
  // 85 of a granted 100 is the core's `near_limit`, and a watch once a 50% allowance is counted.
  install([{ name: "Atlas", limit: 100, used: 85, allowance: 50 }]);
  mount(<EntitlementStatusBar />);
  await settled();

  expect(screen.getByTitle("Atlas").className).toContain("text-ktn-foreground");
  expect(barNamed("Atlas: 85 / 100").dataset.usageState).toBe("watch");
});

// --- IncludedFeatures ------------------------------------------------------------------------

test("IncludedFeatures: a quota wears the console's state, in the console's words", async () => {
  install([
    { name: "Atlas", limit: 100, used: 10 },
    { name: "Borealis", limit: 100, used: 85 },
    { name: "Cirrus", limit: 100, used: 110, allowance: 20 },
    { name: "Delta", limit: 100, used: 120, allowance: 20 },
    { name: "Ember", limit: 100, used: 130, allowance: 20 },
  ]);
  mount(<IncludedFeatures />);
  await settled();

  const badge = (text: string) => screen.getAllByText(text)[0]!;
  expect(badge("Near limit").className).toContain("text-warning-subtle-foreground");
  expect(badge("In allowance").className).toContain("border-warning-subtle-foreground/40");
  expect(badge("Limit reached").className).toContain("bg-destructive");
  expect(badge("Over limit").className).toContain("bg-destructive");
  // A quota with nothing to report keeps saying it is enabled.
  expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
  // Each shows in the table and in the stacked cards.
  expect(screen.getAllByText("Limit reached")).toHaveLength(2);
});

test("IncludedFeatures: the core's near_limit is not the console's", async () => {
  // 85 of 100 with a 50% allowance: the core says near_limit, the rule says watch.
  install([{ name: "Atlas", limit: 100, used: 85, allowance: 50 }]);
  expect((kaitenClientMock.state.snapshot as LicensingSnapshot).entitlements[0]?.status).toBe(
    "near_limit",
  );
  mount(<IncludedFeatures />);
  await settled();

  expect(screen.queryByText("Near limit")).toBeNull();
  expect(screen.getAllByText("Enabled").length).toBeGreaterThan(0);
});

test("IncludedFeatures: the states are said in French as the console says them", async () => {
  install([
    { name: "Atlas", limit: 100, used: 110, allowance: 20 },
    { name: "Borealis", limit: 100, used: 120, allowance: 20 },
    { name: "Cirrus", limit: 100, used: 130, allowance: 20 },
    { name: "Delta", limit: 100, used: 90 },
  ]);
  mount(<IncludedFeatures />, fr);
  await settled();

  for (const label of [
    "Dépassement toléré",
    "Limite atteinte",
    "Au-delà de la limite",
    "Proche de la limite",
  ]) {
    expect(screen.getAllByText(label).length, label).toBeGreaterThan(0);
  }
});

// --- Paywall ---------------------------------------------------------------------------------

test("Paywall: its bar has the allowance of the quota behind the wall", async () => {
  install([{ name: "API calls", slug: "api_calls", limit: 100, used: 110, allowance: 20 }]);
  mount(
    <Paywall entitlement="api_calls" onUpgrade={() => {}}>
      <div>metered content</div>
    </Paywall>,
  );

  await waitFor(() => expect(bars()).toHaveLength(1));
  const bar = within(document.body).getByRole("progressbar");
  expect(bar.dataset.usageState).toBe("in_allowance");
  expect(bar.getAttribute("aria-valuemax")).toBe("120");
});
