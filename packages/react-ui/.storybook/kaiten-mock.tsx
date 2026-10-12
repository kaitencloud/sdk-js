import * as React from "react";
import { SWRConfig } from "swr";
import type { Cache } from "swr";

import {
  KaitenClient,
  KaitenError,
  KaitenSessionClient,
  normalizeResolvedEntitlements,
  resolveLicenseTerm,
} from "@kaitencloud/client";
import type { KaitenClientLike } from "@kaitencloud/client";
import { KaitenStyleRoot } from "../src/style-root/kaiten-style-root.tsx";
import {
  KaitenProvider,
  type Addon,
  type CreditBalance,
  type Customer,
  type EntitlementUsage,
  type Instance,
  type KaitenCatalog,
  type License,
  type LicenseEntitlement,
  type LicensingSnapshot,
  type Plan,
  type ReportUsageInput,
  type ResolvedFeatureFlag,
  type User,
} from "@kaitencloud/react";

export const STORYBOOK_API_BASE = "https://storybook.kaiten.local";

export const STORY_IDS = {
  customer: "cust-1",
  instance: "inst-1",
  license: "lic-1",
} as const;

export const STORY_SLUGS = {
  customer: "demo-customer",
  instance: "demo-instance",
  license: "lic-demo",
} as const;

const storyUser: User = { id: "user-1", name: "Storybook" };

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * A licence window that is always CURRENT, expressed relative to now.
 *
 * `baseInstance` used to set `startLicenseDate === endLicenseDate === now`, i.e. a
 * zero-length term that `resolveLicenseTerm` reads as **expired**. That went
 * unnoticed for as long as the double omitted `licenseTerm` altogether. Once the
 * double started deriving the term the way the client does, every story that shows
 * the term read "expired". The term is information and closes no gate, so the stories
 * that gate are unaffected, but the ones that show a plan need a plan that is current.
 *
 * Relative rather than pinned, deliberately: fixed dates would be a time bomb that
 * expires the entire story suite on a future morning. A story that renders the date
 * itself pins its own window instead (see billing-summary.stories.tsx).
 */
function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function baseLicense(overrides?: Partial<License>): License {
  return {
    id: STORY_IDS.license,
    slug: STORY_SLUGS.license,
    name: "Pro License",
    description: "Storybook fixture license",
    type: "PAID",
    version: "1.0.0",
    versionName: "2026.04",
    lifecycleState: "PUBLISHED",
    familyId: "fam-1",
    isDefault: true,
    ...overrides,
  };
}

export function baseInstance(overrides?: Partial<Instance>): Instance {
  const now = isoNow();
  return {
    id: STORY_IDS.instance,
    slug: STORY_SLUGS.instance,
    name: "Demo instance",
    description: "Storybook fixture",
    customerId: STORY_IDS.customer,
    customerSlug: STORY_SLUGS.customer,
    licenseId: STORY_IDS.license,
    licenseSlug: STORY_SLUGS.license,
    startLicenseDate: isoDaysFromNow(-90),
    endLicenseDate: isoDaysFromNow(275),
    metadata: {},
    createdBy: storyUser,
    createdAt: now,
    updatedBy: storyUser,
    updatedAt: now,
    ...overrides,
  };
}

export function baseCustomer(overrides?: Partial<Customer>): Customer {
  const now = isoNow();
  return {
    id: STORY_IDS.customer,
    slug: STORY_SLUGS.customer,
    name: "Demo Customer Inc.",
    externalCustomerId: null,
    createdBy: storyUser,
    createdAt: now,
    updatedBy: storyUser,
    updatedAt: now,
    ...overrides,
  };
}

export function baseEntitlement(
  license: License,
  fields: Pick<
    LicenseEntitlement,
    "entitlementName" | "entitlementSlug" | "entitlementType" | "value"
  >,
): LicenseEntitlement {
  const now = isoNow();
  return {
    licenseId: license.id,
    licenseSlug: license.slug,
    createdBy: storyUser,
    createdAt: now,
    updatedBy: storyUser,
    updatedAt: now,
    ...fields,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const defaultPlans = (): Plan[] => [
  {
    id: "starter",
    slug: "starter",
    name: "Starter",
    description: "For solo builders and small projects.",
    price: 1900,
    currencyCode: "USD",
    interval: "month",
    features: ["1 instance", "Basic entitlements", "Community support"],
  },
  {
    id: "pro",
    slug: "pro",
    name: "Pro",
    description: "Best for growing teams.",
    price: 7900,
    annualPrice: 79000,
    currencyCode: "USD",
    interval: "month",
    highlighted: true,
    badge: "Popular",
    features: ["10 instances", "Advanced usage limits", "Priority support"],
  },
  {
    id: "enterprise",
    slug: "enterprise",
    name: "Enterprise",
    description: "Custom controls and scale.",
    price: 24900,
    currencyCode: "USD",
    interval: "month",
    features: ["Unlimited instances", "SAML/SSO", "Dedicated success manager"],
  },
];

export interface KaitenFetchMockScenario {
  instance: Instance;
  license: License;
  entitlements: LicenseEntitlement[];
  usageRows: EntitlementUsage[];
  customer?: Customer;
  flags?: ResolvedFeatureFlag[];
  plans?: Plan[];
  addOns?: Addon[];
  credits?: CreditBalance[];
  branding?: { removable: boolean };
}

let originalFetch: typeof fetch | undefined;

function toSnapshot(scenario: KaitenFetchMockScenario): LicensingSnapshot {
  const customer = scenario.customer ?? baseCustomer();

  return {
    source: "snapshot",
    customer,
    instance: scenario.instance,
    license: scenario.license,
    // Derived, not hand-written. This field was simply ABSENT from the double, so
    // every story saw `licenseTerm: undefined` no matter what dates its instance
    // carried — a component reading the term could not be exercised here at all.
    // Deriving it with the client's own function is what keeps the fixture honest.
    licenseTerm: resolveLicenseTerm(scenario.instance),
    plans: scenario.plans ?? defaultPlans(),
    addOns: scenario.addOns ?? [],
    credits: scenario.credits ?? [],
    entitlements: normalizeResolvedEntitlements(scenario.entitlements, scenario.usageRows),
    flags: scenario.flags ?? [],
    actions: [
      {
        type: "upgrade_plan",
        label: "Upgrade version",
        eventName: "kaiten:plan-changed",
      },
      {
        type: "add_quota",
        label: "Add quota",
        eventName: "kaiten:quota-added",
      },
      {
        type: "manage_addon",
        label: "Add add-ons",
        eventName: "kaiten:addon-added",
      },
    ],
    capabilities: {
      paymentMethods: false,
      invoices: false,
      unsubscribe: false,
      checkout: false,
    },
    branding: scenario.branding ?? { removable: false },
    updatedAt: isoNow(),
  };
}

export interface InstallKaitenFetchMockOptions {
  /** Artificial delay in ms applied to every mocked response — useful to exhibit Skeleton states. */
  delayMs?: number;
  /** Forces snapshot/catalog endpoints to fail with HTTP 500 — used to exhibit error states. */
  forceError?: boolean;
}

export function installKaitenFetchMock(
  scenario: KaitenFetchMockScenario,
  options?: InstallKaitenFetchMockOptions,
): void {
  if (originalFetch === undefined) {
    originalFetch = globalThis.fetch.bind(globalThis);
  }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlString =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      return originalFetch!(input, init);
    }

    if (url.origin !== new URL(STORYBOOK_API_BASE).origin) {
      return originalFetch!(input, init);
    }

    if (options?.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/\/$/, "") || "/";

    // The client composes catalog/snapshot from the read endpoints below
    // (Option A); force-error those so error/failed stories still work.
    if (
      options?.forceError &&
      method === "GET" &&
      (path === "/licenses" || path.startsWith("/customers/") || path.startsWith("/instances/"))
    ) {
      return json(
        { title: "Storybook mock: forced error", status: 500, detail: "forceError=true" },
        500,
      );
    }

    const usageMatch = /^\/instances\/([^/]+)\/entitlements\/([^/]+)\/usage$/.exec(path);
    if (usageMatch && method === "POST") {
      const instanceSlug = usageMatch[1];
      const entitlementSlug = usageMatch[2];
      if (instanceSlug !== scenario.instance.slug) {
        return json({ title: "Not found", status: 404 }, 404);
      }

      const existing =
        scenario.usageRows.find((row) => row.entitlementSlug === entitlementSlug) ??
        ({
          entitlementId: `${scenario.license.id}:${entitlementSlug}`,
          entitlementSlug,
          licenseId: scenario.license.id,
          licenseSlug: scenario.license.slug,
          value: { type: "number", value: 0 },
        } satisfies EntitlementUsage);

      return json(existing);
    }

    // --- Composed read endpoints (Option A: the client composes catalog/snapshot
    //     from these instead of hitting /components/*). ---
    if (method === "GET" && path === "/licenses") {
      return json([scenario.license]);
    }
    const licenseEntitlementsMatch = /^\/licenses\/([^/]+)\/entitlements$/.exec(path);
    if (method === "GET" && licenseEntitlementsMatch) {
      return json(
        licenseEntitlementsMatch[1] === scenario.license.slug ? scenario.entitlements : [],
      );
    }
    const licenseMatch = /^\/licenses\/([^/]+)$/.exec(path);
    if (method === "GET" && licenseMatch) {
      return licenseMatch[1] === scenario.license.slug
        ? json(scenario.license)
        : json({ title: "Not found", status: 404 }, 404);
    }
    const usageGetMatch = /^\/instances\/([^/]+)\/entitlements\/usage$/.exec(path);
    if (method === "GET" && usageGetMatch) {
      return json(usageGetMatch[1] === scenario.instance.slug ? scenario.usageRows : []);
    }
    if (method === "GET" && path === "/instances") {
      return json([scenario.instance]);
    }
    const instanceMatch = /^\/instances\/([^/]+)$/.exec(path);
    if (method === "GET" && instanceMatch) {
      const key = instanceMatch[1];
      return key === scenario.instance.slug || key === scenario.instance.id
        ? json(scenario.instance)
        : json({ title: "Not found", status: 404 }, 404);
    }
    const customerMatch = /^\/customers\/([^/]+)$/.exec(path);
    if (method === "GET" && customerMatch) {
      return json(scenario.customer ?? baseCustomer());
    }

    return json({ title: "Storybook mock: unmatched route", status: 404, detail: path }, 404);
  };
}

export function restoreKaitenFetchMock(): void {
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch;
  }
}

// Builds a KaitenClient backed by the scenario fixtures, bypassing the network.
// Lets Storybook drive the full (rich) components via the provider's `client`
// prop, independent of the live SDK's composed (minimal) snapshot.
export function createStoryClient(
  scenario: KaitenFetchMockScenario,
  options?: InstallKaitenFetchMockOptions,
): KaitenClientLike {
  const settle = async (): Promise<void> => {
    if (options?.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options?.forceError) {
      throw new KaitenError({
        title: "Storybook mock: forced error",
        status: 500,
        detail: "forceError=true",
      });
    }
  };

  return {
    async getCatalog(): Promise<KaitenCatalog> {
      await settle();
      const snapshot = toSnapshot(scenario);
      return { plans: snapshot.plans, branding: snapshot.branding };
    },
    async getLicensingSnapshot(): Promise<LicensingSnapshot> {
      await settle();
      return toSnapshot(scenario);
    },
    async evaluateFlag(key: string) {
      return (scenario.flags ?? []).find((flag) => flag.key === key) ?? { key, value: false };
    },
    async evaluateFlags() {
      return { flags: scenario.flags ?? [] };
    },
    async reportUsage(
      _instanceSlug: string,
      entitlementSlug: string,
      input: ReportUsageInput,
    ): Promise<EntitlementUsage> {
      return {
        entitlementId: `${scenario.license.id}:${entitlementSlug}`,
        entitlementSlug,
        licenseId: scenario.license.id,
        licenseSlug: scenario.license.slug,
        value: input.value,
      };
    },
  };
}

export interface KaitenStoryProviderProps {
  scenario: KaitenFetchMockScenario;
  children: React.ReactNode;
  /**
   * Adds an artificial delay to every mocked fetch response so loading skeletons stay visible.
   * Pass `true` for the default 1500ms, or a number of milliseconds.
   */
  simulateLoading?: boolean | number;
  /**
   * Forces snapshot/catalog endpoints to fail with HTTP 500 — used to exhibit error/failed states.
   */
  simulateError?: boolean;
  /**
   * Forwards to `KaitenProvider`. When `true`, attribution is hidden only if the mocked snapshot/catalog
   * has `branding.removable: true` — use a scenario override in Storybook when wiring Controls.
   */
  hideBranding?: boolean;
}

const DEFAULT_LOADING_DELAY_MS = 1500;

function resolveDelayMs(simulateLoading: boolean | number | undefined): number | undefined {
  if (simulateLoading === undefined || simulateLoading === false) return undefined;
  if (simulateLoading === true) return DEFAULT_LOADING_DELAY_MS;
  return simulateLoading;
}

function buildStoryClientOptions(
  simulateLoading: boolean | number | undefined,
  simulateError: boolean | undefined,
): InstallKaitenFetchMockOptions | undefined {
  const delayMs = resolveDelayMs(simulateLoading);
  if (delayMs === undefined && !simulateError) return undefined;
  return {
    ...(delayMs !== undefined ? { delayMs } : {}),
    ...(simulateError ? { forceError: true } : {}),
  };
}

/**
 * A cache that belongs to one story and nothing else.
 *
 * SWR keys the licensing snapshot on `(mode, customerId, instanceId)`, and every
 * scenario in this file is built from the same fixed `baseCustomer()`/`baseInstance()`
 * ids while returning *different* data. Sharing SWR's module-level cache therefore
 * makes stories leak into each other: whichever one resolves first answers for the
 * rest, so `scenarioGateDenied` renders as allowed simply because an allowed story
 * ran before it.
 *
 * That is order dependence, and it reaches further than the docs page — the a11y
 * addon audits whatever branch the contamination produced, which is how a contrast
 * violation appeared in CI on markup that renders fine locally.
 *
 * `KaitenProvider` nests its own `SWRConfig` for options only; a nested config
 * inherits the parent's cache provider, so supplying one here isolates the whole
 * subtree. Real consumers are unaffected: distinct customers mean distinct keys.
 */
function useIsolatedSWRCache(): () => Cache {
  const cache = React.useMemo<Cache>(() => new Map(), []);
  return React.useCallback(() => cache, [cache]);
}

export function KaitenStoryProvider({
  scenario,
  children,
  simulateLoading,
  simulateError,
  hideBranding = false,
}: KaitenStoryProviderProps) {
  const client = React.useMemo(
    () => createStoryClient(scenario, buildStoryClientOptions(simulateLoading, simulateError)),
    [scenario, simulateLoading, simulateError],
  );
  const provider = useIsolatedSWRCache();

  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="authenticated"
        apiUrl={STORYBOOK_API_BASE}
        accessToken="storybook-token"
        customerId={(scenario.customer ?? baseCustomer()).id}
        instanceId={scenario.instance.id}
        polling={{ enabled: false }}
        hideBranding={hideBranding}
        client={client}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

export function KaitenPublicStoryProvider({
  scenario,
  children,
  simulateLoading,
  simulateError,
  hideBranding = false,
}: KaitenStoryProviderProps) {
  const client = React.useMemo(
    () => createStoryClient(scenario, buildStoryClientOptions(simulateLoading, simulateError)),
    [scenario, simulateLoading, simulateError],
  );
  const provider = useIsolatedSWRCache();

  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="public"
        apiUrl={STORYBOOK_API_BASE}
        publishableKey="pk_storybook"
        polling={{ enabled: false }}
        hideBranding={hideBranding}
        client={client}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

/**
 * What the public catalogue of Acme is, as Kaiten serves it for `GET /public/catalog`:
 * produced by Kaiten's own code and held to the API contract by the client's tests. A
 * story that draws a catalogue from it draws what the client makes of a real one.
 */
export { default as acmeCatalog } from "../../client/tests/fixtures/public-catalog.acme.json";

/** What the API answers a catalogue read: a status, a body, and the problem it is. */
export interface ServedCatalogReply {
  status: number;
  body: unknown;
}

/**
 * What Kaiten answers a publishable key used from an origin its owner did not allow: the
 * problem document its own error renderer writes for a 403 `PublicAuth.OriginNotAllowed`.
 */
export const originNotAllowedReply: ServedCatalogReply = {
  status: 403,
  body: {
    type: "https://tools.ietf.org/html/rfc7231#section-6.5.3",
    title: "Forbidden",
    status: 403,
    detail: "this publishable key does not allow requests from this origin",
    instance: "/api/public/catalog",
    code: "PublicAuth.OriginNotAllowed",
  },
};

/**
 * A public provider on the real client, which reads the catalogue from a `fetch` that
 * answers `reply`: the mapping, the splitting of prices into `prices` and
 * `billingPrices`, and the errors are the client's own, not a double's.
 */
export function KaitenServedCatalogStoryProvider({
  children,
  reply,
}: {
  children: React.ReactNode;
  reply: ServedCatalogReply;
}) {
  const client = React.useMemo(
    () =>
      new KaitenClient({
        apiUrl: STORYBOOK_API_BASE,
        authScheme: "publishable",
        tokenProvider: () => "pk_storybook_served",
        fetch: async () =>
          new Response(JSON.stringify(reply.body), {
            status: reply.status,
            headers: {
              "Content-Type": reply.status < 400 ? "application/json" : "application/problem+json",
            },
          }),
      }),
    [reply],
  );
  const provider = useIsolatedSWRCache();

  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="public"
        apiUrl={STORYBOOK_API_BASE}
        // Not the key of the other public provider: the same scope as a provider above it
        // would be a passthrough, and the stories would draw the plans of that one.
        publishableKey="pk_storybook_served"
        polling={{ enabled: false }}
        client={client}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

/**
 * What the portal of a customer session answers, for Initech, as Kaiten serves it for
 * `GET /public/session/portal`: one entry per state (`portal` is an instance on Pro, subscribed
 * monthly; `portalPastDue` a quarterly subscription whose payment failed; `portalCustomerWide` a
 * session bound to the customer only). Produced by Kaiten's own code and held to the API
 * contract by the client's tests.
 */
export { default as initechSession } from "../../client/tests/fixtures/session.initech.json";

/**
 * A customer-session provider on the real client and the real session client, whose `fetch`
 * answers the portal with `portal`: what a component draws is what the client makes of it.
 */
export function KaitenSessionStoryProvider({
  children,
  portal,
}: {
  children: React.ReactNode;
  portal: unknown;
}) {
  const sessionClient = React.useMemo(
    () =>
      new KaitenSessionClient({
        apiUrl: STORYBOOK_API_BASE,
        fetch: async () =>
          new Response(JSON.stringify(portal), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        getCustomerSession: () => ({
          token: `kst_${"s".repeat(43)}`,
          expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        }),
      }),
    [portal],
  );
  const provider = useIsolatedSWRCache();

  return (
    <SWRConfig value={{ provider }}>
      <KaitenProvider
        mode="customer-session"
        sessionClient={sessionClient}
        apiUrl={STORYBOOK_API_BASE}
        polling={{ enabled: false }}
      >
        <KaitenStyleRoot>{children}</KaitenStyleRoot>
      </KaitenProvider>
    </SWRConfig>
  );
}

export function scenarioPortalDefault(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  const customer = baseCustomer();
  const entitlements: LicenseEntitlement[] = [
    baseEntitlement(license, {
      entitlementName: "Premium",
      entitlementSlug: "premium",
      entitlementType: "BOOLEAN",
      value: { type: "boolean", value: true },
    }),
    baseEntitlement(license, {
      entitlementName: "API calls",
      entitlementSlug: "api_calls",
      entitlementType: "NUMBER",
      value: { type: "number", value: 10_000 },
    }),
    baseEntitlement(license, {
      entitlementName: "Seats",
      entitlementSlug: "seats",
      entitlementType: "NUMBER",
      value: { type: "number", value: 25 },
    }),
  ];
  const usageRows: EntitlementUsage[] = [
    {
      entitlementId: "e-api",
      entitlementSlug: "api_calls",
      licenseId: license.id,
      licenseSlug: license.slug,
      value: { type: "number", value: 4200 },
    },
    {
      entitlementId: "e-seat",
      entitlementSlug: "seats",
      licenseId: license.id,
      licenseSlug: license.slug,
      value: { type: "number", value: 12 },
    },
  ];

  return {
    instance,
    license,
    customer,
    entitlements,
    usageRows,
    credits: [
      {
        id: "credit-api",
        slug: "api-credits",
        name: "API credits",
        unit: "calls",
        included: 10_000,
        consumed: 4200,
        available: 5800,
      },
    ],
    addOns: [
      {
        slug: "priority-support",
        name: "Priority support",
        description: "Faster response times and escalation coverage.",
        active: true,
        price: 4900,
        currencyCode: "USD",
        interval: "month",
      },
      {
        slug: "audit-log",
        name: "Audit log",
        description: "Extended audit retention and exports.",
        active: false,
        price: 1900,
        currencyCode: "USD",
        interval: "month",
      },
    ],
    flags: [
      {
        key: "premium-feature",
        enabled: true,
        value: true,
        reason: "story",
      },
    ],
    plans: defaultPlans(),
  };
}

export function scenarioPaywallNearLimit(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [
      baseEntitlement(license, {
        entitlementName: "API calls",
        entitlementSlug: "api_calls",
        entitlementType: "NUMBER",
        value: { type: "number", value: 1000 },
      }),
    ],
    usageRows: [
      {
        entitlementId: "e-api",
        entitlementSlug: "api_calls",
        licenseId: license.id,
        licenseSlug: license.slug,
        value: { type: "number", value: 850 },
      },
    ],
    plans: defaultPlans(),
  };
}

export function scenarioPaywallOverLimit(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [
      baseEntitlement(license, {
        entitlementName: "API calls",
        entitlementSlug: "api_calls",
        entitlementType: "NUMBER",
        value: { type: "number", value: 1000 },
      }),
    ],
    usageRows: [
      {
        entitlementId: "e-api",
        entitlementSlug: "api_calls",
        licenseId: license.id,
        licenseSlug: license.slug,
        value: { type: "number", value: 1000 },
      },
    ],
    plans: defaultPlans(),
  };
}

export function scenarioGateAllowed(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [
      baseEntitlement(license, {
        entitlementName: "Premium",
        entitlementSlug: "premium",
        entitlementType: "BOOLEAN",
        value: { type: "boolean", value: true },
      }),
    ],
    usageRows: [
      {
        entitlementId: "e-premium",
        entitlementSlug: "premium",
        licenseId: license.id,
        licenseSlug: license.slug,
        value: { type: "boolean", value: true },
      },
    ],
  };
}

export function scenarioGateDenied(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [
      baseEntitlement(license, {
        entitlementName: "Premium",
        entitlementSlug: "premium",
        entitlementType: "BOOLEAN",
        value: { type: "boolean", value: false },
      }),
    ],
    usageRows: [
      {
        entitlementId: "e-premium",
        entitlementSlug: "premium",
        licenseId: license.id,
        licenseSlug: license.slug,
        value: { type: "boolean", value: false },
      },
    ],
  };
}

export function scenarioPaywallFlagDisabled(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [],
    usageRows: [],
    flags: [
      {
        key: "premium-feature",
        enabled: false,
        value: false,
        reason: "story",
      },
    ],
    plans: defaultPlans(),
  };
}

export function scenarioPaywallOk(): KaitenFetchMockScenario {
  const license = baseLicense();
  const instance = baseInstance();
  return {
    instance,
    license,
    entitlements: [
      baseEntitlement(license, {
        entitlementName: "API calls",
        entitlementSlug: "api_calls",
        entitlementType: "NUMBER",
        value: { type: "number", value: 1000 },
      }),
    ],
    usageRows: [
      {
        entitlementId: "e-api",
        entitlementSlug: "api_calls",
        licenseId: license.id,
        licenseSlug: license.slug,
        value: { type: "number", value: 320 },
      },
    ],
    plans: defaultPlans(),
  };
}
