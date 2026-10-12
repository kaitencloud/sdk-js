// An application written against @kaitencloud/client 1.0.0, and nothing else.
//
// It is compiled, never run, by `node scripts/check-compat-1.0.mjs`, twice: against
// the declarations of the tarball npm serves for 1.0.0, which proves this file is
// 1.0 code, and against the tarball built from this tree, which proves that 1.0 code
// still compiles. `vp check` compiles it against the build as well.
//
// Do not adapt it to a new release. When a change makes it stop compiling, the
// change is breaking, and a minor release does not get to make it: give the new
// member an optional place, or a name of its own.
//
// There are two exceptions, both corrections of a type the API contradicted.
// 1.1.0 removed `MeterType`, the type of a field no call ever returned: the Kaiten
// API has no meter type. So nothing below names it, and the check lets it go. And
// `EntitlementType` gained `NUMBER_AI_CREDIT`, which `../compat-1.0.test.ts`
// freezes. So nothing below switches over `EntitlementType` without a `default`.
// Every other closed union is switched over exhaustively, on purpose.

import {
  KaitenClient,
  KaitenError,
  KaitenNetworkError,
  UNLIMITED_THRESHOLD,
  assertPublishableKey,
  getMaximumAllowedUsage,
  getUsageScope,
  isEvaluationSuccess,
  isPublishableKey,
  isSoftLimit,
  isUnlimitedThreshold,
  normalizePlanPrices,
  resolveLicenseTerm,
  retry,
  withQuery,
} from "@kaitencloud/client";
import type {
  Addon,
  AggregationMethod,
  BillingCapabilities,
  BillingInterval,
  BulkEvaluationResponse,
  EntitlementType,
  EntitlementUsage,
  EntitlementValue,
  EvaluationSuccess,
  FeatureFlagType,
  KaitenAuthScheme,
  KaitenCatalog,
  KaitenClientConfig,
  KaitenClientLike,
  KaitenComponentsModule,
  KaitenCustomersModule,
  KaitenFetch,
  KaitenFlagsModule,
  KaitenInstancesModule,
  KaitenLicensesModule,
  KaitenThrownError,
  KaitenUsageModule,
  LicenseTerm,
  LicenseType,
  LicensingSnapshot,
  Plan,
  PlanPrice,
  PortalActionType,
  ReportUsageInput,
  ResolvedEntitlement,
  UsageBehavior,
} from "@kaitencloud/client";
import {
  createMockKaitenClient,
  demoCatalog,
  demoCustomer,
  demoInstance,
  demoSnapshot,
} from "@kaitencloud/client/testing";

// -- A pricing page: the catalog, read for a browser ---------------------------

export function pricingClient(apiUrl: string, publishableKey: string): KaitenClient {
  assertPublishableKey(publishableKey);
  const config: KaitenClientConfig = {
    apiUrl,
    authScheme: "publishable",
    tokenProvider: () => publishableKey,
    timeoutMs: 5_000,
    defaultHeaders: { "x-app": "pricing" },
    onAuthError: ({ status, operation }) => console.warn(status, operation),
    onDegraded: ({ operation, error }) => console.warn(operation, error),
  };
  return new KaitenClient(config);
}

/** The monthly flat fee of a plan, as 1.0 hosts read it: from `prices`, in minor units. */
export function monthlyFee(plan: Plan): { amount: number; currencyCode: string } | null {
  const monthly: PlanPrice | undefined = plan.prices?.find((price) => price.interval === "month");
  if (monthly) return { amount: monthly.amount, currencyCode: monthly.currencyCode ?? "USD" };
  if (plan.price !== undefined)
    return { amount: plan.price, currencyCode: plan.currencyCode ?? "USD" };
  return null;
}

export async function pricingTable(client: KaitenClientLike): Promise<string[]> {
  const catalog: KaitenCatalog = await client.getCatalog();
  const rows = catalog.plans.map((plan) => {
    const fee = monthlyFee(normalizePlanPrices(plan));
    const annual: number | undefined = plan.annualPrice;
    const addOns: Addon[] = plan.addOns ?? [];
    const features: string[] = plan.features ?? [];
    return [
      plan.slug,
      plan.name,
      fee ? `${fee.amount} ${fee.currencyCode}` : "on request",
      annual === undefined ? "" : `${annual} a year`,
      plan.highlighted ? "highlighted" : "",
      `${addOns.length} add-ons`,
      features.join(", "),
      (plan.entitlements ?? []).map((entitlement) => entitlement.slug).join("|"),
    ].join(" · ");
  });
  const removable: boolean = catalog.branding?.removable ?? false;
  return removable ? rows : [...rows, "Powered by Kaiten"];
}

export const looksPublishable = (key: string): boolean => isPublishableKey(key);
export const queryFor = (cursor: string | undefined): string =>
  withQuery("/customers", { cursor, limit: "50" });

// -- A backend: usage, flags and what a failure looks like ---------------------

export function backendClient(apiUrl: string, token: () => string): KaitenClient {
  const fetchImpl: KaitenFetch = async (input, init) => fetch(input, init);
  return new KaitenClient({ apiUrl, authScheme: "bearer", tokenProvider: token, fetch: fetchImpl });
}

export async function meter(
  client: KaitenClientLike,
  instanceSlug: string,
  tokens: number,
): Promise<number | "refused" | "offline"> {
  const input: ReportUsageInput = {
    value: { type: "number", value: tokens },
    behavior: "append",
    metadata: { source: "batch", run: 3 },
  };
  try {
    const usage: EntitlementUsage = await client.reportUsage(instanceSlug, "tokens", input);
    const used: EntitlementValue = usage.value;
    return used.type === "number" ? used.value : 0;
  } catch (error) {
    const thrown = error as KaitenThrownError;
    switch (thrown.kind) {
      case "api":
        return thrown.status === 409 ? "refused" : "refused";
      case "network":
        return "offline";
      default: {
        const unreachable: never = thrown;
        return unreachable;
      }
    }
  }
}

/** What 1.0 hosts did with a refusal: narrow with `instanceof`, read the problem's members. */
export function describeFailure(error: unknown): string {
  if (error instanceof KaitenError) {
    const code: string | undefined = error.code;
    const detail: string | undefined = error.detail;
    const errorId: string | undefined = error.errorId;
    const first = error.errors?.[0];
    return `${error.status} ${code ?? ""} ${detail ?? ""} ${errorId ?? ""} ${first?.message ?? ""}`;
  }
  if (error instanceof KaitenNetworkError) {
    return `offline: ${String(error.cause)}`;
  }
  return "unknown";
}

export async function keepTrying<T>(call: () => Promise<T>): Promise<T> {
  return retry(call, {
    initialDelay: 100,
    maxDelayBetweenRetries: 2_000,
    factor: 2,
    jitter: true,
    shouldRetry: (error, iteration) => iteration < 3 && error instanceof KaitenNetworkError,
  });
}

export async function flagsOf(client: KaitenClientLike, user: string): Promise<string[]> {
  const one: EvaluationSuccess = await client.evaluateFlag("beta", { user });
  const all: BulkEvaluationResponse = await client.evaluateFlags({ user });
  const enabled = all.flags
    .filter(isEvaluationSuccess)
    .map((flag) => `${flag.key}=${flag.variant}`);
  return [`${one.key}:${String(one.value)}:${one.reason ?? ""}`, ...enabled];
}

export async function viaModules(client: KaitenClient): Promise<number> {
  const usage: EntitlementUsage[] | null = await client.usage.getByInstance("acme-prod");
  const detail: EntitlementUsage = await client.usage.getDetail("acme-prod", "tokens");
  const grouped = await client.usage.getByGroup("ai", "acme-prod");
  const customers = (await client.customers.list()) ?? [];
  const instances = (await client.instances.list()) ?? [];
  const licenses = (await client.licenses.list()) ?? [];
  const rows = (await client.licenses.listEntitlements("pro")) ?? [];
  const catalog = await client.components.getCatalog();
  const snapshot = await client.components.getSnapshot("acme", "acme-prod");
  await client.flags.evaluate("beta");
  await client.flags.evaluateAll();
  await client.getCustomer("acme");
  await client.getInstance("acme-prod");
  await client.getLicense("pro");
  await client.getLicenseEntitlement("pro", "tokens");
  await client.getInstanceUsage("acme-prod");
  await client.getInstanceEntitlementUsage("acme-prod", "tokens");
  await client.getEntitlementGroupUsage("ai", "acme-prod");
  return (
    (usage?.length ?? 0) +
    detail.entitlementId.length +
    (grouped?.length ?? 0) +
    customers.length +
    instances.length +
    licenses.length +
    rows.length +
    catalog.plans.length +
    snapshot.entitlements.length
  );
}

// -- Reading a customer's licensing snapshot -----------------------------------

export function gate(entitlement: ResolvedEntitlement): "allow" | "warn" | "block" {
  if (entitlement.usageUnavailable) return "block";
  if (entitlement.unlimited) return "allow";
  switch (entitlement.status) {
    case "enabled":
      return "allow";
    case "near_limit":
      return "warn";
    case "over_limit":
    case "disabled":
      return "block";
    default: {
      const unreachable: never = entitlement.status;
      return unreachable;
    }
  }
}

export function limitOf(entitlement: ResolvedEntitlement): string {
  const limit: EntitlementValue = entitlement.limitValue;
  const threshold = limit.type === "number" ? limit.value : null;
  const ceiling = getMaximumAllowedUsage(threshold, entitlement.limitCapExceededOveragePercent);
  const soft = isSoftLimit(threshold, entitlement.limitCapExceededOveragePercent);
  const unlimited = isUnlimitedThreshold(threshold) || threshold === UNLIMITED_THRESHOLD;
  const scope = getUsageScope(entitlement);
  return `${ceiling ?? "no ceiling"} ${soft ? "soft" : "hard"} ${unlimited ? "unlimited" : ""} ${scope}`;
}

export function origin(entitlement: ResolvedEntitlement): string {
  switch (entitlement.source) {
    case "license":
      return "your plan";
    case "addon":
      return "an add-on";
    case "credit":
      return "credits";
    default: {
      const unreachable: never = entitlement.source;
      return unreachable;
    }
  }
}

export function kind(entitlement: ResolvedEntitlement): string {
  const type: EntitlementType = entitlement.type;
  // `EntitlementType` is deliberately not switched over without a `default`: see
  // the header of this file.
  switch (type) {
    case "BOOLEAN":
      return "switch";
    case "CONFIG":
      return "setting";
    default:
      return "quota";
  }
}

export function summary(snapshot: LicensingSnapshot, now: Date): string {
  const term: LicenseTerm | null | undefined =
    snapshot.licenseTerm ?? resolveLicenseTerm(snapshot.instance, now);
  const capabilities: BillingCapabilities = snapshot.capabilities;
  return [
    snapshot.customer?.name,
    snapshot.instance?.slug,
    snapshot.license?.type,
    term?.status,
    capabilities.checkout ? "checkout" : "",
    snapshot.entitlements.map(gate).join(","),
    snapshot.flags.map((flag) => flag.key).join(","),
    snapshot.actions.map((action) => action.type).join(","),
    snapshot.credits.map((credit) => credit.available).join(","),
  ].join(" | ");
}

// -- The closed unions of 1.0, switched over without a default -----------------

export function intervalLabel(interval: BillingInterval): string {
  switch (interval) {
    case "month":
      return "monthly";
    case "year":
      return "yearly";
    case "one_time":
      return "once";
    default: {
      const unreachable: never = interval;
      return unreachable;
    }
  }
}

export function behaviorLabel(behavior: UsageBehavior): string {
  switch (behavior) {
    case "append":
      return "adds";
    case "set":
      return "replaces";
    default: {
      const unreachable: never = behavior;
      return unreachable;
    }
  }
}

export function schemeLabel(scheme: KaitenAuthScheme): string {
  switch (scheme) {
    case "bearer":
      return "token";
    case "publishable":
      return "key";
    case "none":
      return "anonymous";
    default: {
      const unreachable: never = scheme;
      return unreachable;
    }
  }
}

export function termLabel(term: LicenseTerm): string {
  switch (term.status) {
    case "active":
      return "active";
    case "expired":
      return "expired";
    case "not_started":
      return "later";
    default: {
      const unreachable: never = term.status;
      return unreachable;
    }
  }
}

export function valueLabel(value: EntitlementValue): string {
  switch (value.type) {
    case "number":
      return String(value.value);
    case "boolean":
      return value.value ? "yes" : "no";
    case "object":
      return JSON.stringify(value.value);
    default: {
      const unreachable: never = value;
      return unreachable;
    }
  }
}

export function actionLabel(type: PortalActionType): string {
  switch (type) {
    case "upgrade_plan":
    case "add_quota":
    case "manage_addon":
    case "open_checkout":
    case "cancel_subscription":
    case "update_payment":
    case "contact_sales":
      return type.replace("_", " ");
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function flagTypeLabel(type: FeatureFlagType): string {
  switch (type) {
    case "boolean":
    case "string":
    case "number":
    case "object":
      return type;
    default: {
      const unreachable: never = type;
      return unreachable;
    }
  }
}

export function aggregationLabel(aggregation: AggregationMethod): string {
  const aggregations: Record<AggregationMethod, string> = {
    COUNT: "count",
    SUM: "sum",
    AVERAGE: "average",
    MIN: "min",
    MAX: "max",
    LATEST: "latest",
  };
  return aggregations[aggregation];
}

export function licenseTypeLabel(type: LicenseType): string {
  const labels: Record<LicenseType, string> = {
    DEVELOPMENT: "dev",
    TRIAL: "trial",
    PAID: "paid",
    COMMUNITY: "community",
  };
  return labels[type];
}

// -- A host's own client, and the modules it fills in ---------------------------

/** A client of its own: exactly the five methods of 1.0, no cast. */
export class CachingClient implements KaitenClientLike {
  private catalog?: Promise<KaitenCatalog>;

  constructor(private readonly inner: KaitenClientLike) {}

  getCatalog = (): Promise<KaitenCatalog> => (this.catalog ??= this.inner.getCatalog());
  getLicensingSnapshot = (customerId: string, instanceId?: string): Promise<LicensingSnapshot> =>
    this.inner.getLicensingSnapshot(customerId, instanceId);
  evaluateFlag = (key: string, context?: Record<string, unknown>): Promise<EvaluationSuccess> =>
    this.inner.evaluateFlag(key, context);
  evaluateFlags = (context?: Record<string, unknown>): Promise<BulkEvaluationResponse> =>
    this.inner.evaluateFlags(context);
  reportUsage = (
    instanceSlug: string,
    entitlementSlug: string,
    input: ReportUsageInput,
  ): Promise<EntitlementUsage> => this.inner.reportUsage(instanceSlug, entitlementSlug, input);
}

const usageRow: EntitlementUsage = {
  entitlementId: "e",
  entitlementSlug: "tokens",
  licenseId: "l",
  licenseSlug: "pro",
  value: { type: "number", value: 1 },
};

/** Each module of `KaitenClient`, implemented with the members 1.0 gave it and no more. */
export const modules: {
  components: KaitenComponentsModule;
  customers: KaitenCustomersModule;
  instances: KaitenInstancesModule;
  licenses: KaitenLicensesModule;
  usage: KaitenUsageModule;
  flags: KaitenFlagsModule;
} = {
  components: {
    getCatalog: async () => ({ plans: [] }),
    getSnapshot: async () => demoSnapshot(),
  },
  customers: { get: async () => demoCustomer(), list: async () => null },
  instances: { get: async () => demoInstance(), list: async () => null },
  licenses: {
    get: async () => {
      throw new Error("not served");
    },
    list: async () => null,
    getEntitlement: async () => {
      throw new Error("not served");
    },
    listEntitlements: async () => null,
  },
  usage: {
    getByInstance: async () => [usageRow],
    getDetail: async () => usageRow,
    report: async () => usageRow,
    getByGroup: async () => null,
  },
  flags: {
    evaluate: async (key) => ({ key, value: true }),
    evaluateAll: async () => ({ flags: [] }),
  },
};

// -- A test of the host's own code, with the mock of 1.0 ------------------------

export async function exercise(): Promise<number> {
  const reported: string[] = [];
  const mock = createMockKaitenClient({
    catalog: demoCatalog(),
    snapshot: demoSnapshot(),
    delayMs: 0,
    onReportUsage: (instanceSlug, entitlementSlug, input) =>
      reported.push(`${instanceSlug}/${entitlementSlug}/${behaviorLabel(input.behavior)}`),
  });
  const client: KaitenClientLike = mock;
  await meter(client, "acme-prod", 3);
  mock.setCatalog({ plans: [] });
  mock.setSnapshot(demoSnapshot());
  const reports: number = mock.usageReports.length;
  return reports + reported.length + (await pricingTable(client)).length;
}
