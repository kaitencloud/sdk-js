// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { kaitenClientMock } from "./support/kaiten-client-double.ts";
import { KaitenProvider } from "../src/providers/kaiten-provider.tsx";
import { TelemetryProvider, useTelemetry } from "../src/telemetry/context.tsx";
import { useEntitlement } from "../src/hooks/use-entitlement.ts";
import { useLicenseEntitlementsList } from "../src/hooks/use-entitlements.ts";
import { useFeatureFlag } from "../src/hooks/use-feature-flag.ts";
import { useFeatureFlags } from "../src/hooks/use-feature-flags.ts";
import { useEntitlementCheck } from "../src/hooks/use-entitlement-check.ts";
import { usePaywallTrigger } from "../src/hooks/use-paywall-trigger.ts";
import { useLicensingSnapshot } from "../src/hooks/use-licensing-snapshot.ts";
import { useInstance } from "../src/hooks/use-instance.ts";
import { useAddOns } from "../src/hooks/use-kaiten-addons.ts";
import { useCredits } from "../src/hooks/use-kaiten-credits.ts";
import { useCustomer } from "../src/hooks/use-kaiten-customer.ts";
import { useEntitlements } from "../src/hooks/use-kaiten-entitlements.ts";
import { useFlags } from "../src/hooks/use-kaiten-flags.ts";
import { useKaitenMutation, useKaitenQuery } from "../src/hooks/use-kaiten-query.ts";
import { kaitenKeys } from "../src/hooks/query-keys.ts";
import { useKaitenScopeKey } from "../src/hooks/use-kaiten-scope-key.ts";
import { useReportUsage } from "../src/hooks/use-report-usage.ts";
import { useUpgradeOptions } from "../src/hooks/use-upgrade-options.ts";
import { useUsage, useUsageGroup } from "../src/hooks/use-usage.ts";
import type {
  Customer,
  EntitlementUsage,
  Instance,
  License,
  LicensingSnapshot,
  Plan,
} from "../src/types.ts";

// The React layer is tested against the KaitenClient *interface*, not the network.
// Option A composes catalog/snapshot from existing endpoints, so
// the live v1 SDK only yields a minimal snapshot. To keep verifying that the (richer)
// components and hooks render correctly when given full data, we mock the client and
// feed fixtures directly — decoupling component tests from the SDK's data-assembly path.
// Shared with components.test.tsx — see tests/support/kaiten-client-double.ts.
vi.mock("@kaitencloud/client", async (importActual) => {
  const actual = await importActual<typeof import("@kaitencloud/client")>();
  const { createKaitenClientDouble } = await import("./support/kaiten-client-double.ts");
  return { ...actual, KaitenClient: createKaitenClientDouble() };
});

// This suite exercises an enabled flag with a variant, where components.test.tsx
// exercises a disabled one.
kaitenClientMock.setFlagBehaviour({
  flag: (key: string) => ({ key, value: true, variant: "b", reason: "targeting_match" }),
  flags: () => ({
    flags: [{ key: "gradual-rollout", value: true, variant: "b", reason: "targeting_match" }],
  }),
});

const user = { id: "user-1", name: "Test User" };
let testId = 0;

const customer: Customer = {
  id: "cust-1",
  slug: "acme",
  name: "Acme Corp",
  externalCustomerId: "external-acme",
  createdBy: user,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedBy: user,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const instance: Instance = {
  id: "inst-1",
  slug: "prod-instance",
  name: "Production",
  description: "Primary instance",
  customerId: customer.id,
  customerSlug: customer.slug,
  licenseId: "lic-1",
  licenseSlug: "pro",
  startLicenseDate: "2026-04-10T00:00:00.000Z",
  endLicenseDate: "2026-12-31T00:00:00.000Z",
  metadata: {},
  createdBy: user,
  createdAt: "2026-04-10T00:00:00.000Z",
  updatedBy: user,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

const license: License = {
  id: "lic-1",
  slug: "pro",
  name: "Pro License",
  description: "Paid license",
  type: "PAID",
  version: "1.0.0",
  versionName: "2026.04",
  lifecycleState: "PUBLISHED",
  familyId: "fam-1",
  isDefault: true,
};

const plans: Plan[] = [
  {
    id: "plan-free",
    slug: "free",
    name: "Free",
    price: 0,
    currencyCode: "USD",
    interval: "month",
  },
  {
    id: "plan-pro",
    slug: "pro",
    name: "Pro",
    price: 49,
    currencyCode: "USD",
    interval: "month",
  },
  {
    id: "plan-enterprise",
    slug: "enterprise",
    name: "Enterprise",
    price: 199,
    currencyCode: "USD",
    interval: "month",
  },
  {
    id: "plan-private",
    slug: "private",
    name: "Private",
    price: 999,
    currencyCode: "USD",
    interval: "month",
    published: false,
  },
];

const baseSnapshot: LicensingSnapshot = {
  source: "snapshot",
  customer,
  instance,
  license,
  plans,
  addOns: [
    {
      id: "addon-support",
      slug: "priority-support",
      name: "Priority support",
      active: true,
      price: 29,
      currencyCode: "USD",
      interval: "month",
    },
  ],
  credits: [
    {
      id: "credit-api",
      slug: "api-credits",
      name: "API credits",
      unit: "calls",
      included: 1000,
      consumed: 950,
      available: 50,
    },
  ],
  entitlements: [
    {
      id: "ent-api",
      slug: "api_calls",
      name: "API calls",
      type: "NUMBER",
      category: "Core",
      source: "license",
      limitValue: { type: "number", value: 1000 },
      currentValue: { type: "number", value: 950 },
      remaining: 50,
      percentageUsed: 95,
      status: "near_limit",
      currentPeriodStart: "2026-03-01T00:00:00Z",
      currentPeriodEnd: "2026-04-01T00:00:00Z",
      actions: [
        {
          type: "add_quota",
          label: "Add quota",
          eventName: "kaiten:quota-added",
        },
      ],
    },
    {
      id: "ent-seat",
      slug: "seats",
      name: "Seats",
      type: "NUMBER",
      tags: ["Core"],
      source: "license",
      limitValue: { type: "number", value: 5 },
      currentValue: { type: "number", value: 5 },
      remaining: 0,
      percentageUsed: 100,
      status: "over_limit",
    },
    {
      id: "ent-sso",
      slug: "sso",
      name: "SSO",
      type: "BOOLEAN",
      tags: ["Core"],
      source: "license",
      limitValue: { type: "boolean", value: true },
      currentValue: { type: "boolean", value: false },
      status: "disabled",
    },
    {
      id: "ent-workspace",
      slug: "workspace_config",
      name: "Workspace config",
      type: "CONFIG",
      category: "Core",
      source: "addon",
      limitValue: { type: "object", value: { tier: "pro" } },
      currentValue: null,
      configLabel: "Enterprise tier",
      status: "enabled",
    },
  ],
  flags: [
    {
      key: "gradual-rollout",
      enabled: true,
      value: "variant-a",
      variant: "a",
      reason: "rule_match",
      percentage: 50,
      metadata: { cohort: "beta" },
    },
    {
      key: "disabled-flag",
      enabled: false,
      value: false,
      reason: "default",
    },
  ],
  actions: [],
  capabilities: {
    paymentMethods: true,
    invoices: true,
    unsubscribe: false,
    checkout: true,
  },
  branding: { removable: true },
};

function nextCustomerId() {
  testId += 1;
  return `cust-hooks-${testId}`;
}

// Seeds the mocked client with the snapshot/catalog fixtures for a test.
function installFetchMock(snapshot: LicensingSnapshot = baseSnapshot) {
  kaitenClientMock.state.snapshot = snapshot;
  kaitenClientMock.state.catalog = { plans, branding: { removable: false } };
  return kaitenClientMock;
}

function authenticatedWrapper(options?: {
  snapshot?: LicensingSnapshot;
  telemetryTransport?: (event: unknown) => void;
}) {
  installFetchMock(options?.snapshot);
  const customerId = nextCustomerId();

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_hooks"
        customerId={customerId}
        polling={{ enabled: false }}
        telemetry={{ transport: options?.telemetryTransport }}
      >
        {children}
      </KaitenProvider>
    );
  };
}

function publicWrapper() {
  installFetchMock();

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <KaitenProvider mode="public" publishableKey="pk_hooks" polling={{ enabled: false }}>
        {children}
      </KaitenProvider>
    );
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  kaitenClientMock.resetScopes();
});

test("snapshot-derived hooks expose customer, instance, entitlements, flags, usage, and upgrades", async () => {
  const { result } = renderHook(
    () => ({
      addOns: useAddOns(),
      credits: useCredits(),
      customer: useCustomer(),
      entitlement: useEntitlement("api_calls"),
      entitlementMissing: useEntitlement("missing"),
      entitlements: useEntitlements(),
      featureFlag: useFeatureFlag("gradual-rollout"),
      featureFlags: useFeatureFlags(),
      flags: useFlags(),
      gateApiMin25: useEntitlementCheck("api_calls", { min: 25 }),
      gateApiMin100: useEntitlementCheck("api_calls", { min: 100 }),
      gateOverLimit: useEntitlementCheck("seats"),
      instance: useInstance(),
      licenseEntitlements: useLicenseEntitlementsList(),
      upgradeOptions: useUpgradeOptions(),
      usageAll: useUsage(),
      usageMissing: useUsage("missing"),
      usageOne: useUsage("api_calls"),
      usageGroup: useUsageGroup("Core"),
    }),
    { wrapper: authenticatedWrapper() },
  );

  await waitFor(() => {
    expect(result.current.customer.data?.name).toBe("Acme Corp");
  });

  expect(result.current.instance.data?.slug).toBe("prod-instance");
  expect(result.current.entitlements.data).toHaveLength(4);
  expect(result.current.flags.data).toHaveLength(2);
  expect(result.current.addOns.data?.[0]?.slug).toBe("priority-support");
  expect(result.current.credits.data?.[0]?.available).toBe(50);
  expect(result.current.licenseEntitlements.data?.[0]).toMatchObject({
    // `licenseID` -> `licenseId`: the backend now publishes domain names rather
    // than transport names for its OAS components.
    licenseId: "lic-1",
    licenseSlug: "pro",
    entitlementSlug: "api_calls",
    entitlementType: "NUMBER",
  });
  expect(result.current.entitlement.data?.entitlementName).toBe("API calls");
  expect(result.current.entitlementMissing.data).toBeUndefined();
  expect(result.current.featureFlag.data).toEqual({
    key: "gradual-rollout",
    value: "variant-a",
    variant: "a",
    reason: "rule_match",
    metadata: { cohort: "beta" },
  });
  expect(result.current.featureFlags.data?.flags).toEqual([
    {
      key: "gradual-rollout",
      value: "variant-a",
      variant: "a",
      reason: "rule_match",
      metadata: { cohort: "beta" },
    },
    {
      key: "disabled-flag",
      value: false,
      variant: undefined,
      reason: "default",
      metadata: undefined,
    },
  ]);
  expect(result.current.gateApiMin25.allowed).toBe(true);
  expect(result.current.gateApiMin100).toMatchObject({
    allowed: false,
    current: 950,
    limit: 1000,
    remaining: 50,
    percentageUsed: 95,
  });
  expect(result.current.gateOverLimit.allowed).toBe(false);
  expect(result.current.usageOne.data).toMatchObject({
    entitlementId: "ent-api",
    entitlementSlug: "api_calls",
    licenseId: "lic-1",
    licenseSlug: "pro",
    value: { type: "number", value: 950 },
    // `EntitlementUsage` declares these bounds, so a host reading them off
    // `useUsage().data` is reading what its own types promise. The projection
    // used to drop them, making that promise permanently `undefined`.
    currentPeriodStart: "2026-03-01T00:00:00Z",
    currentPeriodEnd: "2026-04-01T00:00:00Z",
  });
  expect(result.current.usageMissing.data).toBeNull();
  expect(result.current.usageAll.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entitlementSlug: "api_calls" }),
      expect.objectContaining({ entitlementSlug: "workspace_config" }),
    ]),
  );
  expect(result.current.usageGroup.data).toEqual([
    expect.objectContaining({
      entitlementSlug: "api_calls",
      licenseValue: "1,000",
      usageValue: "950",
    }),
    expect.objectContaining({
      entitlementSlug: "seats",
      licenseValue: "5",
      usageValue: "5",
    }),
    expect.objectContaining({
      entitlementSlug: "sso",
      licenseValue: "true",
      usageValue: "false",
    }),
    expect.objectContaining({
      entitlementSlug: "workspace_config",
      licenseValue: "Config",
      usageValue: "-",
    }),
  ]);
  expect(result.current.upgradeOptions.data?.map((plan) => plan.slug)).toEqual([
    "free",
    "enterprise",
  ]);
});

test("useFeatureFlag and useFeatureFlags evaluate live via OFREP when a context is provided", async () => {
  const context = { plan: "pro" };
  const { result } = renderHook(
    () => ({
      flag: useFeatureFlag("gradual-rollout", context),
      flags: useFeatureFlags(context),
    }),
    { wrapper: authenticatedWrapper() },
  );

  await waitFor(() => {
    expect(result.current.flag.data?.reason).toBe("targeting_match");
  });
  expect(result.current.flag.data).toMatchObject({
    key: "gradual-rollout",
    value: true,
    variant: "b",
  });

  await waitFor(() => {
    expect(result.current.flags.data?.flags).toHaveLength(1);
  });
  expect(result.current.flags.data?.flags[0]).toMatchObject({ reason: "targeting_match" });

  // The hooks evaluate live via the client, forwarding the provided context.
  expect(kaitenClientMock.evaluateFlag).toHaveBeenCalledWith("gradual-rollout", context);
  expect(kaitenClientMock.evaluateFlags).toHaveBeenCalledWith(context);
});

test("useKaitenQuery supports enabled, disabled, and manual refetch flows", async () => {
  const queryFn = vi.fn(async () => `value-${queryFn.mock.calls.length}`);
  const { result } = renderHook(
    () =>
      useKaitenQuery({
        queryKey: ["hooks", "query", "enabled"],
        queryFn,
      }),
    { wrapper: publicWrapper() },
  );

  await waitFor(() => {
    expect(result.current.data).toBe("value-1");
  });

  act(() => {
    result.current.refetch();
  });

  await waitFor(() => {
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
  expect(result.current.data).toBe("value-2");

  cleanup();
  vi.unstubAllGlobals();

  const disabledQueryFn = vi.fn(async () => "unused");
  const disabled = renderHook(
    () =>
      useKaitenQuery({
        queryKey: ["hooks", "query", "disabled"],
        queryFn: disabledQueryFn,
        enabled: false,
      }),
    { wrapper: publicWrapper() },
  );

  expect(disabled.result.current.data).toBeUndefined();
  expect(disabled.result.current.isLoading).toBe(false);
  expect(disabledQueryFn).not.toHaveBeenCalled();
});

test("useKaitenMutation tracks success, sync mutate, and normalized errors", async () => {
  const onSuccess = vi.fn();
  const onError = vi.fn();
  const mutationFn = vi.fn(async (input: string) => ({ value: input.toUpperCase() }));
  const { result } = renderHook(() =>
    useKaitenMutation({
      mutationFn,
      onSuccess,
      onError,
      revalidateKeys: [["hooks", "mutation", "revalidate"]],
    }),
  );

  await act(async () => {
    await expect(result.current.mutateAsync("ok")).resolves.toEqual({ value: "OK" });
  });

  expect(result.current.data).toEqual({ value: "OK" });
  expect(result.current.isPending).toBe(false);
  expect(result.current.error).toBeNull();
  expect(onSuccess).toHaveBeenCalledWith({ value: "OK" });

  act(() => {
    result.current.mutate("sync");
  });

  await waitFor(() => {
    expect(result.current.data).toEqual({ value: "SYNC" });
  });

  const failing = renderHook(() =>
    useKaitenMutation({
      mutationFn: async () => {
        throw "boom";
      },
      onError,
    }),
  );

  await act(async () => {
    await expect(failing.result.current.mutateAsync("bad")).rejects.toThrow("boom");
  });

  expect(failing.result.current.error?.message).toBe("boom");
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
});

test("useReportUsage reports usage, emits telemetry, and surfaces mode and snapshot errors", async () => {
  const telemetryTransport = vi.fn();
  const onSuccess = vi.fn();
  const { result } = renderHook(
    () => ({
      instance: useInstance(),
      reportUsage: useReportUsage({ onSuccess }),
    }),
    {
      wrapper: authenticatedWrapper({ telemetryTransport }),
    },
  );

  await waitFor(() => {
    expect(result.current.instance.data?.slug).toBe("prod-instance");
  });

  let reported: EntitlementUsage | undefined;
  await act(async () => {
    reported = await result.current.reportUsage.mutateAsync({
      entitlementSlug: "api_calls",
      input: {
        behavior: "set",
        value: { type: "number", value: 951 },
        metadata: { source: "test" },
      },
    });
  });

  expect(reported).toMatchObject({
    entitlementSlug: "api_calls",
    value: { type: "number", value: 951 },
  });
  expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ entitlementSlug: "api_calls" }));
  expect(kaitenClientMock.reportUsage).toHaveBeenCalledWith("prod-instance", "api_calls", {
    behavior: "set",
    value: { type: "number", value: 951 },
    metadata: { source: "test" },
  });
  expect(telemetryTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      type: "action",
      name: "report-usage",
      // Richer detail (value + behavior), and emitted on every call (no once-key).
      metadata: expect.objectContaining({ entitlementSlug: "api_calls", behavior: "set" }),
    }),
  );

  // Regression: the mutation must revalidate the provider snapshot (SWR key parity),
  // i.e. re-invoke the client's snapshot fetcher.
  await waitFor(() => {
    expect(kaitenClientMock.getLicensingSnapshot.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  cleanup();
  vi.unstubAllGlobals();

  const publicResult = renderHook(() => useReportUsage(), { wrapper: publicWrapper() });
  await act(async () => {
    await expect(
      publicResult.result.current.mutateAsync({
        entitlementSlug: "api_calls",
        input: { behavior: "append", value: { type: "number", value: 1 } },
      }),
    ).rejects.toThrow("authenticated mode");
  });

  cleanup();
  vi.unstubAllGlobals();

  const missingInstanceSnapshot: LicensingSnapshot = {
    ...baseSnapshot,
    instance: null,
  };
  const missingInstance = renderHook(() => useReportUsage(), {
    wrapper: authenticatedWrapper({ snapshot: missingInstanceSnapshot }),
  });

  await waitFor(() => {
    expect(missingInstance.result.current.isPending).toBe(false);
  });

  await act(async () => {
    await expect(
      missingInstance.result.current.mutateAsync({
        entitlementSlug: "api_calls",
        input: { behavior: "append", value: { type: "number", value: 1 } },
      }),
    ).rejects.toThrow("instance slug");
  });
});

test("useReportUsage optimistically bumps the gauge before the server responds, then reconciles", async () => {
  // Hold the report in flight so we can observe the optimistic state.
  let resolveReport!: (value: EntitlementUsage) => void;
  kaitenClientMock.reportUsage.mockImplementationOnce(
    () =>
      new Promise<EntitlementUsage>((resolve) => {
        resolveReport = resolve;
      }),
  );

  const { result } = renderHook(
    () => ({
      report: useReportUsage(),
      gate: useEntitlementCheck("api_calls"), // base snapshot: current 950 / limit 1000
    }),
    { wrapper: authenticatedWrapper() },
  );

  await waitFor(() => expect(result.current.gate.current).toBe(950));

  // Fire the report (append 30); don't await — the report promise is still pending.
  act(() => {
    result.current.report.mutate({
      entitlementSlug: "api_calls",
      input: { behavior: "append", value: { type: "number", value: 30 } },
    });
  });

  // Optimistic: the gauge jumps to 980 immediately, before the server answers.
  await waitFor(() => expect(result.current.gate.current).toBe(980));

  // Resolving the report triggers SWR revalidation, reconciling to the server
  // value (the mock returns the base snapshot, current 950).
  await act(async () => {
    resolveReport({
      entitlementId: "ent-api",
      entitlementSlug: "api_calls",
      licenseId: "lic-1",
      licenseSlug: "pro",
      value: { type: "number", value: 980 },
    });
  });
  await waitFor(() => expect(result.current.gate.current).toBe(950));
});

test("useReportUsage hands the report's transactionId to the client, and its outcome back", async () => {
  const { TransactionIdReusedError } = await import("@kaitencloud/client");
  const onError = vi.fn();
  // The first report is answered as a replay of one already applied under its
  // key; the second, the same key with another value, is refused.
  kaitenClientMock.reportUsage
    .mockImplementationOnce(async (_instance, entitlementSlug, input) => ({
      entitlementId: "ent-api",
      entitlementSlug,
      licenseId: "lic-1",
      licenseSlug: "pro",
      value: input.value,
      idempotentReplayed: true,
    }))
    .mockImplementationOnce(async () => {
      throw new TransactionIdReusedError(
        {
          status: 409,
          title: "Conflict",
          code: "ReportEntitlementUsageMetric.TransactionIdReused",
        },
        "llm:9f2c:tokens",
      );
    });

  const { result } = renderHook(
    () => ({ instance: useInstance(), report: useReportUsage({ onError }) }),
    { wrapper: authenticatedWrapper() },
  );
  await waitFor(() => expect(result.current.instance.data?.slug).toBe("prod-instance"));

  const input = {
    behavior: "append" as const,
    value: { type: "number" as const, value: 30 },
    transactionId: "llm:9f2c:tokens",
  };
  let replayed: Awaited<ReturnType<typeof result.current.report.mutateAsync>> | undefined;
  await act(async () => {
    replayed = await result.current.report.mutateAsync({ entitlementSlug: "api_calls", input });
  });

  expect(kaitenClientMock.reportUsage).toHaveBeenLastCalledWith("prod-instance", "api_calls", {
    behavior: "append",
    value: { type: "number", value: 30 },
    transactionId: "llm:9f2c:tokens",
  });
  expect(replayed?.idempotentReplayed).toBe(true);

  await act(async () => {
    await expect(
      result.current.report.mutateAsync({
        entitlementSlug: "api_calls",
        input: { ...input, value: { type: "number", value: 31 } },
      }),
    ).rejects.toBeInstanceOf(TransactionIdReusedError);
  });
  expect(onError).toHaveBeenCalledWith(expect.any(TransactionIdReusedError));
  expect(onError.mock.calls[0]![0]).toMatchObject({
    transactionId: "llm:9f2c:tokens",
    status: 409,
  });
});

test("every kaitenKeys entry is prefixed by the provider scope", () => {
  const publicScope = "public:/api:pk_demo";
  const authedScope = "authenticated:/api:cust-1:inst-1";

  expect(kaitenKeys.all).toEqual(["kaiten"]);
  expect(kaitenKeys.scope(authedScope)).toEqual(["kaiten", authedScope]);
  expect(kaitenKeys.components.catalog(publicScope)).toEqual([
    "kaiten",
    publicScope,
    "components",
    "catalog",
  ]);
  expect(kaitenKeys.components.snapshot(authedScope)).toEqual([
    "kaiten",
    authedScope,
    "components",
    "snapshot",
  ]);

  // The regression this pins: these two carried no scope at all, so two
  // providers on different customers served each other their evaluations.
  expect(kaitenKeys.featureFlag.detail(authedScope, "flag-a")).toEqual([
    "kaiten",
    authedScope,
    "feature-flag",
    "flag-a",
  ]);
  expect(kaitenKeys.featureFlag.bulk(authedScope)).toEqual([
    "kaiten",
    authedScope,
    "feature-flags",
    "bulk",
  ]);

  // No two scopes can collide on any key.
  expect(kaitenKeys.featureFlag.detail(publicScope, "flag-a")).not.toEqual(
    kaitenKeys.featureFlag.detail(authedScope, "flag-a"),
  );
});

test("useEntitlementCheck resolves number, boolean, config, min, and missing entitlements", async () => {
  const { result } = renderHook(
    () => ({
      api: useEntitlementCheck("api_calls"),
      apiMin25: useEntitlementCheck("api_calls", { min: 25 }),
      apiMin100: useEntitlementCheck("api_calls", { min: 100 }),
      seats: useEntitlementCheck("seats"),
      sso: useEntitlementCheck("sso"),
      config: useEntitlementCheck("workspace_config"),
      missing: useEntitlementCheck("ghost"),
    }),
    { wrapper: authenticatedWrapper() },
  );

  await waitFor(() => {
    expect(result.current.api.entitlement).not.toBeNull();
  });

  // NUMBER within limit -> allowed; min checks compare remaining (50) against the requirement.
  expect(result.current.api).toMatchObject({
    allowed: true,
    current: 950,
    limit: 1000,
    percentage: 95,
    remaining: 50,
  });
  expect(result.current.apiMin25.allowed).toBe(true);
  expect(result.current.apiMin100.allowed).toBe(false);

  // NUMBER at limit -> not allowed.
  expect(result.current.seats).toMatchObject({
    allowed: false,
    current: 5,
    limit: 5,
    percentage: 100,
    remaining: 0,
  });

  // BOOLEAN -> allowed reflects the granted limit value, not current usage.
  expect(result.current.sso).toMatchObject({ allowed: true, limit: 1, percentage: 100 });

  // CONFIG -> presence check, always allowed.
  expect(result.current.config.allowed).toBe(true);

  // Missing entitlement -> not allowed, null entitlement.
  expect(result.current.missing).toMatchObject({ allowed: false, entitlement: null, limit: 0 });
});

test("usePaywallTrigger surfaces over-limit, near-limit, threshold, flag, and not-entitled states", async () => {
  const { result } = renderHook(
    () => ({
      apiNear: usePaywallTrigger("api_calls"), // 95% >= 80% default threshold
      apiBelow: usePaywallTrigger("api_calls", 0.99), // 95% < 99% threshold
      seats: usePaywallTrigger("seats"), // at limit
      missing: usePaywallTrigger("ghost"), // no entitlement
      flagOff: usePaywallTrigger("api_calls", { flagKey: "disabled-flag" }),
      flagOn: usePaywallTrigger("api_calls", { threshold: 0.99, flagKey: "gradual-rollout" }),
    }),
    { wrapper: authenticatedWrapper() },
  );

  await waitFor(() => {
    expect(result.current.apiNear.isLoading).toBe(false);
  });

  expect(result.current.apiNear).toMatchObject({ shouldShow: true, reason: "near_limit" });
  expect(result.current.apiNear.recommendedAction).toMatchObject({ type: "add_quota" });
  expect(result.current.apiBelow).toMatchObject({ shouldShow: false, reason: null });
  expect(result.current.seats).toMatchObject({ shouldShow: true, reason: "over_limit" });
  expect(result.current.missing).toMatchObject({ shouldShow: true, reason: "not_entitled" });
  // A disabled flag forces the paywall regardless of usage; an enabled flag does not.
  expect(result.current.flagOff).toMatchObject({ shouldShow: true, reason: "flag_disabled" });
  expect(result.current.flagOn).toMatchObject({ shouldShow: false, reason: null });
});

test("usePaywallTrigger falls back to a reason-appropriate snapshot action when the entitlement has none", async () => {
  const snapshot: LicensingSnapshot = {
    ...baseSnapshot,
    actions: [
      { type: "upgrade_plan", label: "Upgrade" },
      { type: "add_quota", label: "Add quota" },
    ],
    entitlements: [
      {
        id: "ent-bare",
        slug: "bare_metric",
        name: "Bare metric",
        type: "NUMBER",
        source: "license",
        limitValue: { type: "number", value: 100 },
        currentValue: { type: "number", value: 100 }, // at/over limit
        remaining: 0,
        percentageUsed: 100,
        status: "over_limit",
        // intentionally no `actions` of its own → must fall back to snapshot actions
      },
    ],
  };

  const { result } = renderHook(
    () => ({
      overLimit: usePaywallTrigger("bare_metric"), // over_limit → add_quota
      flagOff: usePaywallTrigger("bare_metric", { flagKey: "disabled-flag" }), // flag_disabled → upgrade_plan
    }),
    { wrapper: authenticatedWrapper({ snapshot }) },
  );

  await waitFor(() => expect(result.current.overLimit.isLoading).toBe(false));

  expect(result.current.overLimit).toMatchObject({ reason: "over_limit" });
  expect(result.current.overLimit.recommendedAction).toMatchObject({ type: "add_quota" });
  expect(result.current.flagOff.recommendedAction).toMatchObject({ type: "upgrade_plan" });
});

test("unlimited (-1) entitlements are allowed and never paywalled", async () => {
  // The fixture deliberately carries the PRE-fix buggy remaining/status to prove
  // the gate hook short-circuits on a negative limit regardless of the data layer.
  const unlimitedSnapshot: LicensingSnapshot = {
    ...baseSnapshot,
    entitlements: [
      {
        id: "ent-unlimited",
        slug: "unlimited_api",
        name: "Unlimited API",
        type: "NUMBER",
        source: "license",
        limitValue: { type: "number", value: -1 },
        currentValue: { type: "number", value: 8400 },
        remaining: 0,
        percentageUsed: null,
        status: "over_limit",
      },
    ],
  };

  const { result } = renderHook(
    () => ({
      gate: useEntitlementCheck("unlimited_api"),
      paywall: usePaywallTrigger("unlimited_api"),
    }),
    { wrapper: authenticatedWrapper({ snapshot: unlimitedSnapshot }) },
  );

  await waitFor(() => {
    expect(result.current.gate.entitlement).not.toBeNull();
  });

  expect(result.current.gate).toMatchObject({
    allowed: true,
    isUnlimited: true,
    remaining: null,
    percentage: 0,
  });
  expect(result.current.paywall).toMatchObject({ shouldShow: false, reason: null });
});

test("useLicensingSnapshot exposes the raw provider snapshot", async () => {
  const { result } = renderHook(() => useLicensingSnapshot(), {
    wrapper: authenticatedWrapper(),
  });

  await waitFor(() => {
    expect(result.current.data).toBeDefined();
  });

  expect(result.current.data?.license?.slug).toBe("pro");
  expect(result.current.data?.entitlements).toHaveLength(4);
});

test("KaitenProvider initialData seeds SWR so server data renders immediately", () => {
  installFetchMock(baseSnapshot);

  const { result } = renderHook(() => useLicensingSnapshot(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <KaitenProvider
        mode="authenticated"
        accessToken="tmp_r16"
        customerId="cust-r16-initial"
        polling={{ enabled: false }}
        initialData={{ snapshot: baseSnapshot }}
      >
        {children}
      </KaitenProvider>
    ),
  });

  // No waitFor: the data is present on the very first render via fallbackData —
  // no loading flash before the client-side revalidation lands.
  expect(result.current.isLoading).toBe(false);
  expect(result.current.data?.license?.slug).toBe("pro");
});

test("telemetry: action events fire on every call and respect shouldTrack/sampleRate gates", () => {
  const transport = vi.fn();
  const trackWith = (opts: Record<string, unknown>) =>
    renderHook(() => useTelemetry(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <TelemetryProvider telemetry={{ transport, ...opts }}>{children}</TelemetryProvider>
      ),
    }).result.current.track;

  // Action events are NOT deduped (no once-key) — every report must emit.
  const track = trackWith({});
  track({ type: "action", name: "report-usage" });
  track({ type: "action", name: "report-usage" });
  expect(transport.mock.calls.filter((c) => c[0].name === "report-usage")).toHaveLength(2);

  // shouldTrack=false drops the event.
  transport.mockClear();
  trackWith({ shouldTrack: () => false })({ type: "action", name: "x" });
  expect(transport).not.toHaveBeenCalled();

  // sampleRate=0 drops action events deterministically.
  transport.mockClear();
  trackWith({ sampleRate: 0 })({ type: "action", name: "y" });
  expect(transport).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Unknown entitlement slugs — fail-closed, but no longer undebuggable
// ---------------------------------------------------------------------------

// A slug the org doesn't define resolves to `allowed: false`. That is the right
// answer — gating must never reveal a feature because a lookup missed — and it
// is indistinguishable from a genuine denial, so `<Show entitlement="api_calls_">`
// presents as a feature that is simply switched off. Nothing to inspect, and the
// fix is one character.
//
// The warning is deduped per (hook, slug) at module scope, so each test below
// uses a slug of its own.
test("useEntitlementCheck warns in development on an unknown slug, listing the real ones", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { result } = renderHook(() => useEntitlementCheck("api-calls-typo"), {
    wrapper: authenticatedWrapper(),
  });

  await waitFor(() => expect(warn).toHaveBeenCalled());

  expect(result.current.allowed).toBe(false);
  const message = String(warn.mock.calls[0]?.[0]);
  expect(message).toContain("api-calls-typo");
  expect(message).toContain("fail-closed");
  // The available slugs are what turn the message into an answer.
  expect(message).toContain("api_calls");
  warn.mockRestore();
});

test("useEntitlement warns on an unknown slug too", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  renderHook(() => useEntitlement("seats-typo"), { wrapper: authenticatedWrapper() });

  await waitFor(() => expect(warn).toHaveBeenCalled());
  expect(String(warn.mock.calls[0]?.[0])).toContain('useEntitlement("seats-typo")');
  warn.mockRestore();
});

test("a known slug never warns", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { result } = renderHook(() => useEntitlementCheck("api_calls"), {
    wrapper: authenticatedWrapper(),
  });

  await waitFor(() => expect(result.current.entitlement).not.toBeNull());
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

// "Not found YET" is not "not found". Warning before the snapshot resolves would
// fire on every mount of every gate in the app, which is how a useful warning
// becomes one adopters filter out.
test("no warning is emitted while the snapshot is still loading", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  renderHook(() => useEntitlementCheck("loading-phase-typo"), {
    wrapper: authenticatedWrapper(),
  });

  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

// `Show` calls the entitlement hook with "" on its flag-condition branch, so an
// empty slug is a normal internal call, not a mistake to report.
test("an empty slug is never reported", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  renderHook(() => useEntitlementCheck(""), { wrapper: authenticatedWrapper() });

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("the same unknown slug is reported once, not once per poll", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const { rerender } = renderHook(() => useEntitlementCheck("repeat-typo"), {
    wrapper: authenticatedWrapper(),
  });

  await waitFor(() => expect(warn).toHaveBeenCalled());
  for (let index = 0; index < 5; index += 1) rerender();

  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

// A quota whose consumption could not be read must not answer "allowed".
// Before this, a failed usage leg resolved as `currentValue: 0`, so every capped
// entitlement looked empty and every check said yes — the SDK's strongest
// fail-open, and silent.
test("an entitlement whose usage could not be read fails closed", async () => {
  const snapshotWithUnknownUsage: LicensingSnapshot = {
    ...baseSnapshot,
    entitlements: baseSnapshot.entitlements.map((entitlement) =>
      entitlement.slug === "api_calls"
        ? {
            ...entitlement,
            currentValue: null,
            remaining: null,
            percentageUsed: null,
            usageUnavailable: true,
          }
        : entitlement,
    ),
  };

  const { result } = renderHook(() => useEntitlementCheck("api_calls"), {
    wrapper: authenticatedWrapper({ snapshot: snapshotWithUnknownUsage }),
  });

  await waitFor(() => expect(result.current.entitlement).not.toBeNull());

  expect(result.current.allowed).toBe(false);
  expect(result.current.remaining).toBeNull();
  expect(result.current.percentageUsed).toBeNull();
  // The grant itself is still known and reported.
  expect(result.current.limit).toBe(1000);
});

// An expired license grants nothing. `endLicenseDate` was carried on the
// Instance and read by no one, so a lapsed license kept every entitlement.
test("an expired license denies every entitlement it used to grant", async () => {
  const expired: LicensingSnapshot = {
    ...baseSnapshot,
    licenseTerm: {
      status: "expired",
      startsAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:00.000Z",
    },
  };

  const { result } = renderHook(
    () => ({
      metered: useEntitlementCheck("api_calls"), // 950/1000 — would be allowed
      boolean: useEntitlementCheck("sso"),
    }),
    { wrapper: authenticatedWrapper({ snapshot: expired }) },
  );

  await waitFor(() => expect(result.current.metered.entitlement).not.toBeNull());

  expect(result.current.metered.allowed).toBe(false);
  expect(result.current.boolean.allowed).toBe(false);
  // The grant is still described, so the UI can say what the license covered.
  expect(result.current.metered.limit).toBe(1000);
});

test("a license inside its term is unaffected", async () => {
  const active: LicensingSnapshot = {
    ...baseSnapshot,
    licenseTerm: {
      status: "active",
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    },
  };

  const { result } = renderHook(() => useEntitlementCheck("api_calls"), {
    wrapper: authenticatedWrapper({ snapshot: active }),
  });

  await waitFor(() => expect(result.current.entitlement).not.toBeNull());
  expect(result.current.allowed).toBe(true);
});

// kaitenKeys is a public export, and every entry now needs the scope. Without a
// public way to read it the keys would be exported but not constructible.
test("useKaitenScopeKey gives a host the scope its cache entries are filed under", async () => {
  const { result } = renderHook(() => useKaitenScopeKey(), {
    wrapper: authenticatedWrapper(),
  });

  expect(typeof result.current).toBe("string");
  expect(result.current.length).toBeGreaterThan(0);

  // It is the prefix of the SDK's own keys, so `mutate()` from the host targets
  // the same entry the provider reads.
  expect(kaitenKeys.components.snapshot(result.current)[1]).toBe(result.current);
});
