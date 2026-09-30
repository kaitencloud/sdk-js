import type {
  Addon,
  CreditBalance,
  Customer,
  Instance,
  KaitenCatalog,
  License,
  LicensingSnapshot,
  Plan,
  ResolvedEntitlement,
  ResolvedFeatureFlag,
  User,
} from "../client/types.ts";

/**
 * Fixtures for `createMockKaitenClient` — and for any test or story that needs a
 * licensing shape without an API behind it.
 *
 * Everything is a factory rather than a shared constant, so one test mutating
 * what it received cannot reach another. Fixed ids and timestamps keep snapshot
 * assertions and visual baselines stable.
 *
 * The values are the shapes the SDK really produces, not the minimum that
 * type-checks: amounts in **minor units** (`7900` = $79.00), a distinct sale
 * unit on the metered entitlement, one entitlement near its limit, one over it,
 * one unlimited, and one hidden from customer-facing components.
 */

const FIXED_TIME = "2026-01-15T09:00:00.000Z";
const RENEWAL_DATE = "2026-12-31T00:00:00.000Z";
// A calendar month, UTC-aligned — the shape a CALENDAR anchor produces. The
// demo set needs at least one PERIODIC and one LIFETIME counter, or every
// downstream assertion about window labels passes over a uniform set and
// proves nothing.
const WINDOW_START = "2026-03-01T00:00:00Z";
const WINDOW_END = "2026-04-01T00:00:00Z";

const fixtureUser: User = { id: "usr_fixture", name: "Fixture" };

export function demoCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cus_2Nf8kQvXpLmR4tYw",
    slug: "acme",
    name: "Acme Corporation",
    externalCustomerId: null,
    createdBy: fixtureUser,
    createdAt: FIXED_TIME,
    updatedBy: fixtureUser,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

export function demoInstance(overrides: Partial<Instance> = {}): Instance {
  return {
    id: "ins_7Kj2mWqZxNc9vBds",
    slug: "acme-production",
    name: "Production",
    description: "Acme's production workspace",
    customerId: "cus_2Nf8kQvXpLmR4tYw",
    customerSlug: "acme",
    licenseId: "lic_4Hg6nRtYuIo1pAsd",
    licenseSlug: "growth",
    startLicenseDate: FIXED_TIME,
    endLicenseDate: RENEWAL_DATE,
    metadata: {},
    createdBy: fixtureUser,
    createdAt: FIXED_TIME,
    updatedBy: fixtureUser,
    updatedAt: FIXED_TIME,
    ...overrides,
  };
}

export function demoLicense(overrides: Partial<License> = {}): License {
  return {
    id: "lic_4Hg6nRtYuIo1pAsd",
    slug: "growth",
    name: "Growth",
    description: "For teams shipping to production",
    type: "PAID",
    version: "3",
    versionName: "2026.01",
    isDefault: false,
    lifecycleState: "PUBLISHED",
    familyId: "fam_7Kd2pQwErTy3uIo9",
    renewalDate: RENEWAL_DATE,
    billingInterval: "month",
    ...overrides,
  };
}

/**
 * A three-tier catalog with real amounts.
 *
 * Plan slugs match license slugs, as `planFromLicense` guarantees on the live
 * read path — which is what lets the customer portal join a license to its
 * price. A fixture that broke that would quietly disable the join it is
 * supposed to be exercising.
 */
export function demoPlans(): Plan[] {
  return [
    {
      id: "lic_1Aa2Bb3Cc4Dd5Ee6",
      slug: "starter",
      name: "Starter",
      description: "For solo builders and side projects",
      price: 0,
      currencyCode: "USD",
      interval: "month",
      published: true,
      lifecycleState: "PUBLISHED",
      familyId: "fam_2Qw3Er4Ty5Ui6Op7",
      features: ["1 instance", "Community support"],
      entitlements: [
        {
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          value: { type: "number", value: 3 },
          unlimited: false,
          unitSingular: "seat",
          unitPlural: "seats",
          displayOrder: 1,
          userFacing: true,
          category: "Platform",
          tags: ["platform"],
        },
        {
          slug: "tokens",
          name: "AI tokens",
          type: "NUMBER",
          value: { type: "number", value: 1_000_000 },
          unlimited: false,
          unitSingular: "token",
          unitPlural: "tokens",
          // Metered per token, sold per million: this is the pair that turns
          // "$8 per unit" into "$8 per 1M tokens".
          saleUnitSingular: "1M tokens",
          saleUnitPlural: "1M tokens",
          saleUnitFactor: 1_000_000,
          displayOrder: 2,
          userFacing: true,
          category: "AI",
          tags: ["ai"],
        },
        {
          slug: "sso",
          name: "SSO",
          type: "BOOLEAN",
          value: { type: "boolean", value: false },
          displayOrder: 3,
          userFacing: true,
          category: "Security",
          tags: ["security"],
        },
      ],
    },
    {
      id: "lic_4Hg6nRtYuIo1pAsd",
      slug: "growth",
      name: "Growth",
      description: "For teams shipping to production",
      // Minor units: 7900 = $79.00. See `PlanPrice.amount`.
      price: 7900,
      annualPrice: 79_000,
      currencyCode: "USD",
      interval: "month",
      published: true,
      lifecycleState: "PUBLISHED",
      familyId: "fam_7Kd2pQwErTy3uIo9",
      highlighted: true,
      badge: "Popular",
      features: ["10 instances", "Priority support", "Audit trail"],
      entitlements: [
        {
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          value: { type: "number", value: 25 },
          unlimited: false,
          unitSingular: "seat",
          unitPlural: "seats",
          displayOrder: 1,
          userFacing: true,
          category: "Platform",
          tags: ["platform"],
        },
        {
          slug: "tokens",
          name: "AI tokens",
          type: "NUMBER",
          value: { type: "number", value: 40_000_000 },
          unlimited: false,
          unitSingular: "token",
          unitPlural: "tokens",
          saleUnitSingular: "1M tokens",
          saleUnitPlural: "1M tokens",
          saleUnitFactor: 1_000_000,
          displayOrder: 2,
          userFacing: true,
          category: "AI",
          tags: ["ai"],
        },
        {
          slug: "sso",
          name: "SSO",
          type: "BOOLEAN",
          value: { type: "boolean", value: true },
          displayOrder: 3,
          userFacing: true,
          category: "Security",
          tags: ["security"],
        },
      ],
    },
    {
      id: "lic_9Zz8Yy7Xx6Ww5Vv4",
      slug: "enterprise",
      name: "Enterprise",
      description: "Custom controls, custom scale",
      currencyCode: "USD",
      interval: "month",
      published: true,
      lifecycleState: "PUBLISHED",
      familyId: "fam_5Gh6Jk7Lm8Nb9Vc0",
      features: ["Unlimited instances", "SAML/SSO", "Dedicated success manager"],
      entitlements: [
        {
          slug: "seats",
          name: "Seats",
          type: "NUMBER",
          // The unlimited sentinel, with the server-computed flag beside it.
          value: { type: "number", value: -1 },
          unlimited: true,
          unitSingular: "seat",
          unitPlural: "seats",
          displayOrder: 1,
          userFacing: true,
          category: "Platform",
          tags: ["platform"],
        },
        {
          slug: "sso",
          name: "SSO",
          type: "BOOLEAN",
          value: { type: "boolean", value: true },
          displayOrder: 3,
          userFacing: true,
          category: "Security",
          tags: ["security"],
        },
      ],
    },
    {
      // A license that is not for sale, still a draft: real orgs have these, and a
      // pricing table must not publish them. Keeping one here means the filter is
      // exercised by anyone who renders the fixtures rather than only by its own
      // unit test.
      id: "lic_0Ii1Uu2Yy3Tt4Rr5",
      slug: "internal-qa",
      name: "Internal QA",
      description: "Not for sale",
      currencyCode: "USD",
      interval: "month",
      published: false,
      lifecycleState: "DRAFT",
      familyId: "fam_3Az4Sx5Dc6Fv7Gb8",
      features: [],
      entitlements: [],
    },
  ];
}

/**
 * The same catalog with every amount removed — what an org that has not modelled
 * its prices actually returns today, and the state most components must handle
 * without inventing a "0.00".
 */
export function demoPlansWithoutPrices(): Plan[] {
  return demoPlans().map(({ price, annualPrice, prices, ...plan }) => {
    void price;
    void annualPrice;
    void prices;
    return plan;
  });
}

export function demoCatalog(overrides: Partial<KaitenCatalog> = {}): KaitenCatalog {
  return {
    plans: demoPlans(),
    branding: { removable: false },
    ...overrides,
  };
}

export function demoCatalogWithoutPrices(): KaitenCatalog {
  return demoCatalog({ plans: demoPlansWithoutPrices() });
}

/**
 * Entitlements as the snapshot resolves them: limit, current usage and the
 * derived status. Deliberately spans every branch a UI has to render — healthy,
 * near limit, over limit, unlimited, boolean, and one internal counter that
 * `isCustomerFacing` hides.
 */
export function demoEntitlements(): ResolvedEntitlement[] {
  return [
    {
      id: "growth:seats",
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
      source: "license",
      category: "Platform",
      tags: ["platform"],
      unitSingular: "seat",
      unitPlural: "seats",
      displayOrder: 1,
      userFacing: true,
      limitValue: { type: "number", value: 25 },
      currentValue: { type: "number", value: 21 },
      unlimited: false,
      remaining: 4,
      percentageUsed: 84,
      status: "near_limit",
    },
    {
      id: "growth:tokens",
      slug: "tokens",
      name: "AI tokens",
      type: "NUMBER",
      source: "license",
      category: "AI",
      tags: ["ai"],
      unitSingular: "token",
      unitPlural: "tokens",
      saleUnitSingular: "1M tokens",
      saleUnitPlural: "1M tokens",
      saleUnitFactor: 1_000_000,
      displayOrder: 2,
      userFacing: true,
      limitValue: { type: "number", value: 40_000_000 },
      currentValue: { type: "number", value: 12_400_000 },
      unlimited: false,
      remaining: 27_600_000,
      percentageUsed: 31,
      status: "enabled",
      // A token quota resets; a seat count does not. The pair is what makes this
      // one PERIODIC.
      currentPeriodStart: WINDOW_START,
      currentPeriodEnd: WINDOW_END,
    },
    {
      id: "growth:api_calls",
      slug: "api_calls",
      name: "API calls",
      type: "NUMBER",
      source: "license",
      category: "Platform",
      tags: ["platform"],
      unitSingular: "call",
      unitPlural: "calls",
      displayOrder: 3,
      userFacing: true,
      limitValue: { type: "number", value: 100_000 },
      currentValue: { type: "number", value: 100_000 },
      unlimited: false,
      remaining: 0,
      percentageUsed: 100,
      status: "over_limit",
      // Over limit *and* periodic: the case where the window is the whole
      // message, because it turns "buy more" into "wait until the 1st".
      currentPeriodStart: WINDOW_START,
      currentPeriodEnd: WINDOW_END,
    },
    {
      id: "growth:projects",
      slug: "projects",
      name: "Projects",
      type: "NUMBER",
      source: "license",
      category: "Platform",
      tags: ["platform"],
      unitSingular: "project",
      unitPlural: "projects",
      displayOrder: 4,
      userFacing: true,
      limitValue: { type: "number", value: -1 },
      currentValue: { type: "number", value: 312 },
      unlimited: true,
      remaining: null,
      percentageUsed: null,
      status: "enabled",
    },
    {
      id: "growth:sso",
      slug: "sso",
      name: "SSO",
      type: "BOOLEAN",
      source: "license",
      category: "Security",
      tags: ["security"],
      displayOrder: 5,
      userFacing: true,
      limitValue: { type: "boolean", value: true },
      currentValue: { type: "boolean", value: true },
      unlimited: false,
      remaining: null,
      percentageUsed: 100,
      status: "enabled",
    },
    {
      // userFacing: false — an internal counter. Customer-facing components must
      // hide it; a fixture set without one cannot prove that they do.
      id: "growth:internal_jobs",
      slug: "internal_jobs",
      name: "Internal jobs",
      type: "NUMBER",
      source: "license",
      displayOrder: 99,
      userFacing: false,
      limitValue: { type: "number", value: 5000 },
      currentValue: { type: "number", value: 143 },
      unlimited: false,
      remaining: 4857,
      percentageUsed: 2.86,
      status: "enabled",
    },
  ];
}

export function demoFlags(): ResolvedFeatureFlag[] {
  return [
    { key: "new-dashboard", enabled: true, value: true, reason: "TARGETING_MATCH" },
    { key: "beta-export", enabled: false, value: false, reason: "DEFAULT" },
    { key: "checkout-variant", enabled: true, value: "b", variant: "b", reason: "SPLIT" },
  ];
}

export function demoAddOns(): Addon[] {
  return [
    {
      id: "add_3Cc4Dd5Ee6Ff7Gg8",
      slug: "extra-seats",
      name: "Extra seats",
      description: "5 additional seats",
      active: true,
      price: 2500,
      currencyCode: "USD",
      interval: "month",
    },
  ];
}

export function demoCredits(): CreditBalance[] {
  return [
    {
      id: "crd_5Ee6Ff7Gg8Hh9Ii0",
      slug: "support-hours",
      name: "Support hours",
      unit: "hours",
      included: 10,
      consumed: 3,
      available: 7,
      resetAt: RENEWAL_DATE,
    },
  ];
}

/**
 * A complete authenticated snapshot: the customer, their instance, the license
 * they hold, the full catalog, resolved entitlements, flags, add-ons and
 * credits.
 *
 * `license.slug` matches a plan in the catalog, so the portal's price join
 * resolves — a snapshot where it didn't would silently disable the very thing a
 * portal fixture exists to show.
 */
export function demoSnapshot(overrides: Partial<LicensingSnapshot> = {}): LicensingSnapshot {
  return {
    source: "snapshot",
    updatedAt: FIXED_TIME,
    customer: demoCustomer(),
    instance: demoInstance(),
    license: demoLicense(),
    plans: demoPlans(),
    addOns: demoAddOns(),
    credits: demoCredits(),
    entitlements: demoEntitlements(),
    flags: demoFlags(),
    actions: [
      { type: "upgrade_plan", label: "Upgrade version", eventName: "kaiten:plan-changed" },
      { type: "add_quota", label: "Add quota", eventName: "kaiten:quota-added" },
      { type: "manage_addon", label: "Add add-ons", eventName: "kaiten:addon-added" },
    ],
    capabilities: {
      paymentMethods: false,
      invoices: false,
      unsubscribe: false,
      checkout: false,
    },
    branding: { removable: false },
    ...overrides,
  };
}

/** The snapshot as it looks before any price model exists — today's reality. */
export function demoSnapshotWithoutPrices(): LicensingSnapshot {
  return demoSnapshot({ plans: demoPlansWithoutPrices() });
}
