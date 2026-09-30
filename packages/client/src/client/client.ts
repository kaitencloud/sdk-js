import {
  evaluateFlag as evaluateFlagApi,
  evaluateFlagsBulk,
  getCustomer as getCustomerApi,
  getEntitlementGroupUsage,
  getEntitlementUsageMetrics,
  getEntitlementsUsageMetrics,
  getInstance as getInstanceApi,
  getInstances,
  getLicense as getLicenseApi,
  getLicenseEntitlement as getLicenseEntitlementApi,
  getLicenseEntitlements,
  getLicenses,
  listCustomers,
  reportEntitlementUsageMetric,
} from "../core/index.ts";
import type { KaitenClientConfig } from "../core/index.ts";
import {
  defaultActions,
  normalizeBrandingCapability,
  normalizePlansResponse,
  normalizeResolvedEntitlements,
  planFromLicense,
  resolveLicenseTerm,
} from "./normalize.ts";
import { isEvaluationSuccess } from "./feature-flags.ts";
import { KaitenTransport } from "../core/index.ts";
import { LICENSING_CATALOG_QUERY, LICENSING_SNAPSHOT_QUERY } from "../graphql/documents.ts";
import type {
  LicensingCatalogQuery,
  LicensingSnapshotQuery,
} from "../graphql/generated/graphql.ts";
import type {
  BulkEvaluationResponse,
  Customer,
  EntitlementGroupUsageItem,
  EntitlementUsage,
  EvaluationSuccess,
  Instance,
  KaitenCatalog,
  License,
  LicenseEntitlement,
  LicenseEntitlementRow,
  LicensingSnapshot,
  Plan,
  ReportUsageInput,
  ResolvedEntitlement,
  ResolvedFeatureFlag,
} from "./types.ts";

interface GraphQLEnvelope<T> {
  data?: T;
  errors?: { message?: string }[];
}

// The shape every cursor-paginated list endpoint returns (PageCustomer,
// PageInstance, …). Structural rather than a union of the generated aliases, so
// a new paginated endpoint needs no change here.
interface PageOf<T> {
  items: T[];
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * The part of `KaitenClient` a UI actually consumes — five reads and one write.
 *
 * `KaitenClient` is a class with a private field, so TypeScript types it
 * nominally: no object can satisfy it structurally, whatever its shape. That is
 * why every fake in this repo had to end in `as unknown as KaitenClient`, a cast
 * that says the type is lying and turns a swapped-in double into an unchecked
 * one. This interface is the seam stated honestly, so `@kaitencloud/client/testing`
 * — and any host with its own transport, cache or SSR arrangement — can supply
 * an implementation the compiler checks.
 *
 * `KaitenClient implements KaitenClientLike`, so the two cannot drift.
 */
export interface KaitenClientLike {
  getCatalog: () => Promise<KaitenCatalog>;
  getLicensingSnapshot: (customerId: string, instanceId?: string) => Promise<LicensingSnapshot>;
  evaluateFlag: (key: string, context?: Record<string, unknown>) => Promise<EvaluationSuccess>;
  evaluateFlags: (context?: Record<string, unknown>) => Promise<BulkEvaluationResponse>;
  reportUsage: (
    instanceSlug: string,
    entitlementSlug: string,
    input: ReportUsageInput,
  ) => Promise<EntitlementUsage>;
}

export interface KaitenComponentsModule {
  getCatalog: () => Promise<KaitenCatalog>;
  getSnapshot: (customerId: string, instanceId?: string) => Promise<LicensingSnapshot>;
}

export interface KaitenCustomersModule {
  get: (customerSlug: string) => Promise<Customer>;
  list: () => Promise<Customer[] | null>;
}

export interface KaitenInstancesModule {
  get: (instanceSlug: string) => Promise<Instance>;
  list: () => Promise<Instance[] | null>;
}

export interface KaitenLicensesModule {
  get: (licenseSlug: string) => Promise<License>;
  list: () => Promise<License[] | null>;
  getEntitlement: (licenseSlug: string, entitlementSlug: string) => Promise<LicenseEntitlement>;
  listEntitlements: (licenseSlug: string) => Promise<LicenseEntitlement[] | null>;
}

export interface KaitenUsageModule {
  getByInstance: (instanceSlug: string) => Promise<EntitlementUsage[] | null>;
  getDetail: (instanceSlug: string, entitlementSlug: string) => Promise<EntitlementUsage>;
  report: (
    instanceSlug: string,
    entitlementSlug: string,
    input: ReportUsageInput,
  ) => Promise<EntitlementUsage>;
  getByGroup: (
    groupSlug: string,
    instanceSlug: string,
  ) => Promise<EntitlementGroupUsageItem[] | null>;
}

export interface KaitenFlagsModule {
  evaluate: (key: string, context?: Record<string, unknown>) => Promise<EvaluationSuccess>;
  evaluateAll: (context?: Record<string, unknown>) => Promise<BulkEvaluationResponse>;
}

// Result of buildCatalog(): the plan catalog plus the raw licenses and their
// entitlements keyed by slug, so the snapshot can reuse the active license's data
// instead of fetching it (and its entitlements) a second time.
interface CatalogData {
  plans: Plan[];
  licensesBySlug: Map<string, License>;
  entitlementsByLicense: Map<string, LicenseEntitlementRow[]>;
}

// Result of the composed LicensingSnapshot query: everything getLicensingSnapshot
// needs except flags (OFREP stays a separate REST call), in one round-trip.
interface SnapshotGraphQLData {
  customer: Customer;
  instances: Instance[];
  usageByInstance: Map<string, EntitlementUsage[]>;
  catalog: CatalogData;
}

/** The shape this mapping needs, rather than whatever codegen produced today. */
interface GraphQLUsageRow {
  entitlementId: string;
  entitlementSlug: string;
  licenseId: string;
  licenseSlug: string;
  value: unknown;
  limit?: unknown;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
}

/**
 * Maps a GraphQL usage row onto the contract's usage row.
 *
 * It was an inline object listing five fields, which is why the window bounds
 * were dropped twice over: the document did not ask for them, and this mapping
 * would have discarded them even if it did. Both halves are fixed —
 * `LICENSING_SNAPSHOT_QUERY` now selects `limit`, `currentPeriodStart` and
 * `currentPeriodEnd`, and they travel through here — so this path answers the
 * same cadence the REST one does, and `assembleSnapshotGraphQL` no longer has
 * to mark the window unknown.
 *
 * The bounds are forwarded only when present: the API populates both exactly
 * when a reset period is configured, so an absent pair is the entitlement
 * saying "lifetime counter", which the normalizer reads as such.
 */
function usageRowFromGraphql(row: GraphQLUsageRow): EntitlementUsage {
  return {
    entitlementId: row.entitlementId,
    entitlementSlug: row.entitlementSlug,
    licenseId: row.licenseId,
    licenseSlug: row.licenseSlug,
    value: row.value as EntitlementUsage["value"],
    ...(row.limit ? { limit: row.limit as EntitlementUsage["limit"] } : {}),
    ...(row.currentPeriodStart ? { currentPeriodStart: row.currentPeriodStart } : {}),
    ...(row.currentPeriodEnd ? { currentPeriodEnd: row.currentPeriodEnd } : {}),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Page size asked of every cursor-paginated list.
 *
 * The API clamps `limit` to its own maximum (200 — `MaxLimit` in
 * internal/shared/pagination) and falls back to 50 when it is absent. Asking for
 * the maximum is what keeps a full read to a quarter of the round-trips; sending
 * nothing made the browser walk 4× more pages to reach the same rows.
 */
const LIST_PAGE_SIZE = 200;

/**
 * Hard stop on how many pages one `list*` call will follow. Not a budget — see
 * `collectPages`, which throws rather than truncating when it is reached.
 */
const MAX_LIST_PAGES = 100;

const listQuery = (cursor?: string) =>
  cursor ? { cursor, limit: LIST_PAGE_SIZE } : { limit: LIST_PAGE_SIZE };

/**
 * Marker for "the usage read failed", distinct from the `null` the endpoint
 * legitimately answers with when there is no content.
 */
const USAGE_UNAVAILABLE = Symbol("kaiten.usage-unavailable");

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

/** Warn once per (customer, instance) pair — the snapshot re-runs on every poll. */
const warnedImplicitInstance = new Set<string>();

/**
 * The instances an implicit selection may choose from, in a stable order.
 *
 * There is no soft-delete filter because there is no soft delete: `instance` has
 * no `deleted_at` column in kaiten and `DeleteInstance` is a real, cascading
 * DELETE ("no trash to restore from and no include-deleted read" —
 * instances/infrastructure/db/queries/instance.sql). A row that comes back is
 * live by construction. The SDK used to filter on an `Instance.deletedAt` that
 * neither read path could ever populate: REST because the field is absent from
 * the OpenAPI contract, GraphQL because it is absent from the schema — which is
 * one of the five field errors that killed the GraphQL path outright.
 *
 * The sort is what makes the two read paths agree, and is the real guarantee
 * here. They pick from different lists — GraphQL from the customer's own
 * `instances`, REST from the global listing filtered by owner — with no reason
 * for those to arrive in the same order. Ordering both by slug means a
 * GraphQL→REST fallback can no longer change which instance a snapshot
 * describes.
 */
function selectableInstances(instances: readonly Instance[]): Instance[] {
  return instances.slice().sort((left, right) => left.slug.localeCompare(right.slug));
}

/**
 * Picks the instance for a snapshot when the caller named none.
 *
 * One instance is the ordinary case and stays silent. More than one means the
 * SDK is choosing on the host's behalf, and the choice decides which license,
 * quotas and — once billing lands behind this — which bill the portal shows. Say
 * so in development rather than letting a multi-instance customer read another
 * instance's numbers as its own.
 */
function pickImplicitInstance(instances: readonly Instance[], customerId: string): Instance | null {
  const candidates = selectableInstances(instances);
  const chosen = candidates[0] ?? null;

  if (chosen && candidates.length > 1 && !isProduction()) {
    const warningKey = `${customerId}:${chosen.slug}`;
    if (!warnedImplicitInstance.has(warningKey)) {
      warnedImplicitInstance.add(warningKey);
      console.warn(
        `[@kaitencloud/client] No instanceId was given for customer "${customerId}", which has ` +
          `${candidates.length} instances — defaulting to "${chosen.slug}". The plan, quotas and ` +
          `usage in this snapshot describe that instance only. Pass an explicit \`instanceId\` ` +
          `(available: ${candidates.map((instance) => instance.slug).join(", ")}).`,
      );
    }
  }

  return chosen;
}

// Maps the GraphQL license list (shared selection between the LicensingCatalog
// and LicensingSnapshot documents — keep them textually identical) into the
// catalog structure the snapshot/catalog paths consume.
function catalogFromGqlLicenses(licenses: LicensingCatalogQuery["licenses"]["items"]): CatalogData {
  const licensesBySlug = new Map<string, License>();
  const entitlementsByLicense = new Map<string, LicenseEntitlementRow[]>();
  const plans: Plan[] = [];

  for (const gqlLicense of licenses) {
    const license: License = {
      id: gqlLicense.id,
      slug: gqlLicense.slug,
      name: gqlLicense.name,
      description: gqlLicense.description,
      type: gqlLicense.type,
      version: gqlLicense.version,
      versionName: gqlLicense.versionName ?? undefined,
      isDefault: gqlLicense.isDefault,
      lifecycleState: gqlLicense.lifecycleState,
      familyId: gqlLicense.family.id,
    };

    const rows: LicenseEntitlementRow[] = gqlLicense.entitlements.map((grant) => ({
      entitlementSlug: grant.entitlementSlug,
      entitlementName: grant.entitlementName,
      entitlementType: grant.entitlementType,
      licenseSlug: grant.licenseSlug,
      value: grant.value as LicenseEntitlement["value"],
      unlimited: grant.unlimited,
      limitCapExceededOveragePercent: grant.limitCapExceededOveragePercent ?? null,
      entitlement: {
        slug: grant.entitlement.slug,
        name: grant.entitlement.name,
        description: grant.entitlement.description,
        icon: grant.entitlement.icon,
        unitSingular: grant.entitlement.unitSingular,
        unitPlural: grant.entitlement.unitPlural,
        saleUnitSingular: grant.entitlement.saleUnitSingular,
        saleUnitPlural: grant.entitlement.saleUnitPlural,
        saleUnitFactor: grant.entitlement.saleUnitFactor,
        userFacing: grant.entitlement.userFacing,
        displayOrder: grant.entitlement.displayOrder,
        entitlementGroups: grant.entitlement.entitlementGroups,
      },
    }));

    licensesBySlug.set(license.slug, license);
    entitlementsByLicense.set(license.slug, rows);
    plans.push(planFromLicense(license, rows));
  }

  return { plans, licensesBySlug, entitlementsByLicense };
}

const AUTH_SCHEMES: ReadonlySet<unknown> = new Set(["bearer", "publishable", "none"]);

export class KaitenClient implements KaitenClientLike {
  private readonly transport: KaitenTransport;
  private readonly onDegraded: KaitenClientConfig["onDegraded"];

  public readonly components: KaitenComponentsModule;
  public readonly customers: KaitenCustomersModule;
  public readonly instances: KaitenInstancesModule;
  public readonly licenses: KaitenLicensesModule;
  public readonly usage: KaitenUsageModule;
  public readonly flags: KaitenFlagsModule;

  constructor(config: KaitenClientConfig) {
    // No default scheme: publishable keys are not served yet, and a default that
    // sends a header no endpoint reads would fail every call without a word.
    if (!AUTH_SCHEMES.has(config.authScheme)) {
      throw new TypeError(
        'Kaiten authScheme is required: "bearer", "publishable" or "none". ' +
          'Call the API from your backend with "bearer" and a ksh_ token.',
      );
    }
    this.transport = new KaitenTransport(config);
    this.onDegraded = config.onDegraded;

    this.components = {
      getCatalog: () => this.getCatalog(),
      getSnapshot: (customerId, instanceId) => this.getLicensingSnapshot(customerId, instanceId),
    };

    this.customers = {
      get: (customerSlug) => this.getCustomer(customerSlug),
      list: () => this.listCustomers(),
    };

    this.instances = {
      get: (instanceSlug) => this.getInstance(instanceSlug),
      list: () => this.listInstances(),
    };

    this.licenses = {
      get: (licenseSlug) => this.getLicense(licenseSlug),
      list: () => this.listLicenses(),
      getEntitlement: (licenseSlug, entitlementSlug) =>
        this.getLicenseEntitlement(licenseSlug, entitlementSlug),
      listEntitlements: (licenseSlug) => this.listLicenseEntitlements(licenseSlug),
    };

    this.usage = {
      getByInstance: (instanceSlug) => this.getInstanceUsage(instanceSlug),
      getDetail: (instanceSlug, entitlementSlug) =>
        this.getInstanceEntitlementUsage(instanceSlug, entitlementSlug),
      report: (instanceSlug, entitlementSlug, input) =>
        this.reportUsage(instanceSlug, entitlementSlug, input),
      getByGroup: (groupSlug, instanceSlug) =>
        this.getEntitlementGroupUsage(groupSlug, instanceSlug),
    };

    this.flags = {
      evaluate: (key, context) => this.evaluateFlag(key, context),
      evaluateAll: (context) => this.evaluateFlags(context),
    };
  }

  getCustomer(customerSlug: string): Promise<Customer> {
    return this.transport.run(
      (client) =>
        getCustomerApi({
          client,
          path: { customerSlug },
        }),
      `getCustomer(${customerSlug})`,
    ) as Promise<Customer>;
  }

  listCustomers(): Promise<Customer[] | null> {
    return this.collectPages<Customer>(
      "listCustomers()",
      (cursor) =>
        this.transport.run(
          (client) => listCustomers({ client, query: listQuery(cursor) }),
          "listCustomers()",
        ) as Promise<PageOf<Customer> | Customer[] | null>,
    );
  }

  getLicense(licenseSlug: string): Promise<License> {
    return this.transport.run(
      (client) =>
        getLicenseApi({
          client,
          path: { licenseSlug },
        }),
      `getLicense(${licenseSlug})`,
    ) as Promise<License>;
  }

  listLicenses(): Promise<License[] | null> {
    return this.collectPages<License>(
      "listLicenses()",
      (cursor) =>
        this.transport.run(
          (client) => getLicenses({ client, query: listQuery(cursor) }),
          "listLicenses()",
        ) as Promise<PageOf<License> | License[] | null>,
    );
  }

  getLicenseEntitlement(licenseSlug: string, entitlementSlug: string): Promise<LicenseEntitlement> {
    return this.transport.run(
      (client) =>
        getLicenseEntitlementApi({
          client,
          path: { licenseSlug, entitlementSlug },
        }),
      `getLicenseEntitlement(${licenseSlug}, ${entitlementSlug})`,
    );
  }

  listLicenseEntitlements(licenseSlug: string): Promise<LicenseEntitlement[] | null> {
    return this.collectPages<LicenseEntitlement>(
      `listLicenseEntitlements(${licenseSlug})`,
      (cursor) =>
        this.transport.run(
          (client) =>
            getLicenseEntitlements({
              client,
              path: { licenseSlug },
              query: listQuery(cursor),
            }),
          `listLicenseEntitlements(${licenseSlug})`,
        ),
    );
  }

  getInstance(instanceSlug: string): Promise<Instance> {
    return this.transport.run(
      (client) =>
        getInstanceApi({
          client,
          path: { instanceSlug },
        }),
      `getInstance(${instanceSlug})`,
    ) as Promise<Instance>;
  }

  listInstances(): Promise<Instance[] | null> {
    return this.collectPages<Instance>(
      "listInstances()",
      (cursor) =>
        this.transport.run(
          (client) => getInstances({ client, query: listQuery(cursor) }),
          "listInstances()",
        ) as Promise<PageOf<Instance> | Instance[] | null>,
    );
  }

  /**
   * Follows a cursor-paginated list endpoint to the end and returns every row.
   *
   * These `list*` methods promise "the list", and every caller reads them that
   * way — including `resolveSnapshotInstance`, which filters a GLOBAL instance
   * listing down to one customer. Returning only the first page would resolve a
   * snapshot with no instance as soon as the customer's instance sat past it,
   * and a snapshot without an instance opens every gate. Pagination therefore
   * stays an implementation detail here instead of leaking into the signature.
   *
   * A null first page is still null (the endpoint answered with no content); a
   * null page later means the list ended where it ended, and the rows already
   * collected are the honest answer.
   *
   * A bare array is accepted as a single complete page. These same methods feed
   * the REST fan-out this package keeps for APIs without the GraphQL aggregate —
   * those deployments predate cursor pagination and answer with the array
   * directly. Requiring the envelope would drop the compatibility the fallback
   * exists to provide.
   *
   * `MAX_PAGES` is a stop, not a page budget: a server that reports `hasMore`
   * with an unchanged cursor would otherwise spin forever. Reaching it — or
   * seeing the cursor stand still — THROWS rather than returning what was
   * collected so far. The two outcomes are indistinguishable to every caller
   * (both are "the list"), and the one that opens gates must not be the silent
   * one: an instance past the boundary would resolve a snapshot with no
   * instance, which is precisely what this method exists to prevent.
   */
  private async collectPages<T>(
    operation: string,
    fetchPage: (cursor?: string) => Promise<PageOf<T> | T[] | null>,
  ): Promise<T[] | null> {
    const rows: T[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const result = await fetchPage(cursor);
      if (!result) {
        return page === 0 ? null : rows;
      }

      if (Array.isArray(result)) {
        rows.push(...result);
        return rows;
      }

      rows.push(...result.items);
      if (!result.hasMore || !result.nextCursor) {
        return rows;
      }
      if (result.nextCursor === cursor) {
        throw new Error(
          `${operation}: the API returned the same cursor twice (${rows.length} rows read) — ` +
            `the list cannot be followed to the end.`,
        );
      }
      cursor = result.nextCursor;
    }

    throw new Error(
      `${operation}: stopped after ${MAX_LIST_PAGES} pages (${rows.length} rows) with more to ` +
        `read. Returning a partial list here would be indistinguishable from a complete one.`,
    );
  }

  // Executes a GraphQL query against the API's /graphql endpoint through the
  // same transport (auth headers, retry, timeout). GraphQL returns HTTP 200 with
  // an `errors` array on failure, so the envelope is checked here.
  private async graphqlRequest<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const envelope = await this.transport.post<GraphQLEnvelope<T>>(
      "/graphql",
      { query, variables },
      // A POST by protocol, a read by intent: every GraphQL document this client
      // sends is a query, so replaying one is safe and the snapshot should still
      // survive a transient 5xx.
      { idempotent: true },
    );
    if (envelope.errors?.length) {
      throw new Error(
        envelope.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join("; ") || "GraphQL error",
      );
    }
    if (!envelope.data) {
      throw new Error("GraphQL response has no data");
    }
    return envelope.data;
  }

  // Builds the plan catalog from the org's licenses and their entitlements, and
  // returns the raw licenses + per-license entitlements keyed by slug so callers
  // (getLicensingSnapshot) can REUSE them instead of re-fetching the active
  // license and its entitlements a second time.
  //
  // GraphQL-first: ONE query returns every license with its grants AND the full
  // entitlement definitions (presentation metadata: icon, units, userFacing,
  // displayOrder, groups) that the REST license-entitlement projection drops.
  // Falls back to the REST fan-out against an older API without the schema.
  private async buildCatalog(): Promise<CatalogData> {
    try {
      return await this.buildCatalogGraphQL();
    } catch (error) {
      this.reportDegraded("getCatalog", error);
      return this.buildCatalogRest();
    }
  }

  // Tells the host that a composed read just took the REST fan-out. The host's
  // callback is its own business, but it must never be able to fail the read it
  // is reporting on — degrading is already the unhappy path.
  private reportDegraded(operation: string, error: unknown): void {
    try {
      this.onDegraded?.({ operation, error });
    } catch {
      // Ignore: a broken observer is not a reason to lose the snapshot.
    }
  }

  private async buildCatalogGraphQL(): Promise<CatalogData> {
    const first = await this.graphqlRequest<LicensingCatalogQuery>(
      LICENSING_CATALOG_QUERY.toString(),
    );
    return catalogFromGqlLicenses(await this.collectGqlLicenses(first.licenses, "getCatalog"));
  }

  /**
   * Every license, following the cursor from the page the caller already has.
   *
   * `Query.licenses` is a cursor-paginated `LicensePage` and the documents ask
   * for the server's maximum page size (200), so one page is the whole catalog
   * for every organization that exists today. It was also the whole of what this
   * client read: `hasMore` was selected only to REPORT a truncation as a
   * degradation, which left a host past the boundary with a pricing table
   * missing plans and a `licensesBySlug` that could not resolve the license an
   * instance points at — a state that reads as "no entitlements" rather than as
   * a short read. Following the cursor is what the REST fan-out has always done
   * (`collectPages`), and this is the same contract on the GraphQL path:
   *
   *   - stop when the server says there is no more, or hands back no cursor;
   *   - THROW on a cursor that does not move, and on the page cap, rather than
   *     return what was collected so far. A partial catalog and a complete one
   *     are indistinguishable to every caller, and the one that opens gates must
   *     not be the silent one.
   *
   * The extra pages come back through `LICENSING_CATALOG_QUERY`, whose license
   * selection is textually identical to the snapshot's — so a snapshot past the
   * boundary pages through the catalog document and still maps through one code
   * path, without re-reading the customer and its instances on every page.
   */
  private async collectGqlLicenses(
    first: LicensingCatalogQuery["licenses"],
    operation: string,
  ): Promise<LicensingCatalogQuery["licenses"]["items"]> {
    const items = [...first.items];
    let page = first;

    for (let index = 1; index < MAX_LIST_PAGES; index += 1) {
      if (!page.hasMore || !page.nextCursor) return items;
      const cursor: string = page.nextCursor;

      const next = await this.graphqlRequest<LicensingCatalogQuery>(
        LICENSING_CATALOG_QUERY.toString(),
        { cursor },
      );
      if (next.licenses.nextCursor === cursor) {
        throw new Error(
          `${operation}: the API returned the same cursor twice (${items.length} licenses read) — ` +
            `the catalog cannot be followed to the end.`,
        );
      }

      items.push(...next.licenses.items);
      page = next.licenses;
    }

    throw new Error(
      `${operation}: stopped after ${MAX_LIST_PAGES} pages (${items.length} licenses) with more ` +
        `to read. Returning a partial catalog here would be indistinguishable from a complete one.`,
    );
  }

  private async buildCatalogRest(): Promise<CatalogData> {
    const licenses = (await this.listLicenses()) ?? [];
    const licensesBySlug = new Map<string, License>(
      licenses.map((license) => [license.slug, license]),
    );
    const entitlementsByLicense = new Map<string, LicenseEntitlementRow[]>();

    const plans = await Promise.all(
      licenses.map(async (license) => {
        const entitlements = (await this.listLicenseEntitlements(license.slug)) ?? [];
        entitlementsByLicense.set(license.slug, entitlements);
        return planFromLicense(license, entitlements);
      }),
    );

    return { plans, licensesBySlug, entitlementsByLicense };
  }

  private emptyCatalog(): CatalogData {
    return { plans: [], licensesBySlug: new Map(), entitlementsByLicense: new Map() };
  }

  // Evaluates the org's feature flags (OFREP bulk) and maps them to
  // ResolvedFeatureFlag for the snapshot. `enabled` is the evaluated value when
  // boolean — the reason alone can't tell an excluded customer apart (a flag can
  // be ON yet evaluate false via TARGETING_MATCH/STATIC/DEFAULT); for non-boolean
  // flags it falls back to the reason (DISABLED => off). Evaluation failures are
  // dropped. The rollout `percentage` isn't available from evaluation alone (it
  // lives on the flag definition), so it is left null — FlagsSummary renders the
  // rollout badge only when it's a number.
  private async resolveSnapshotFlags(targetingKey: string): Promise<ResolvedFeatureFlag[]> {
    // A targeting key is required or OFREP returns PROVIDER_FATAL ("missing
    // targeting key") for any flag whose rules reference the subject — so scope
    // the evaluation to this customer. Rules that don't match fall back to the
    // flag's default variant.
    const { flags } = await this.evaluateFlags({ targetingKey });
    return flags.filter(isEvaluationSuccess).map((flag) => ({
      key: flag.key,
      enabled: typeof flag.value === "boolean" ? flag.value : flag.reason !== "DISABLED",
      value: flag.value,
      variant: flag.variant,
      reason: flag.reason,
      percentage: null,
      metadata: flag.metadata,
    }));
  }

  // Composed client-side from existing licenses endpoints — there is no bespoke
  // catalog endpoint server-side (Option A, see ARCHITECTURE.md).
  async getCatalog(): Promise<KaitenCatalog> {
    const { plans } = await this.buildCatalog();
    return {
      plans: normalizePlansResponse(plans),
      branding: normalizeBrandingCapability(undefined),
    };
  }

  // Commerce concepts not modelled server-side (add-ons, credits, portal actions,
  // billing capabilities, branding) are returned as defaults.
  //
  // GraphQL-first: ONE composed query returns the customer, its instances with
  // live usage, and the full plan catalog. Flags stay on OFREP (a REST standard)
  // and are fetched alongside on both paths. Falls back to the REST fan-out
  // against an older API without the schema — also when the customer is absent,
  // so the not-found error keeps its canonical REST shape.
  async getLicensingSnapshot(customerId: string, instanceId?: string): Promise<LicensingSnapshot> {
    const flagsPromise = this.resolveSnapshotFlags(customerId).catch(
      (): ResolvedFeatureFlag[] => [],
    );

    // Only the fetch is guarded: assembly errors (the belongs-to-customer check)
    // are domain errors and must reject, not silently re-run over REST.
    //
    // A THROW and a null are different events and only one is a degradation.
    // `buildSnapshotDataGraphQL` returns null when the customer simply is not
    // there — a deliberate route to REST so the not-found keeps its canonical
    // 404 shape, with GraphQL working fine. Reporting that as degraded would
    // fire on every lookup of an unknown customer.
    let data: SnapshotGraphQLData | null = null;
    let graphqlFailed = false;
    try {
      data = await this.buildSnapshotDataGraphQL(customerId);
    } catch (error) {
      graphqlFailed = true;
      this.reportDegraded("getLicensingSnapshot", error);
    }
    if (data) {
      return this.assembleSnapshotGraphQL(data, customerId, instanceId, await flagsPromise);
    }
    return this.getLicensingSnapshotRest(customerId, instanceId, flagsPromise, graphqlFailed);
  }

  // Fetches the composed snapshot data in one GraphQL round-trip. Returns null
  // when the customer does not exist so the caller falls back to REST (whose
  // 404 is the canonical not-found error shape).
  private async buildSnapshotDataGraphQL(customer: string): Promise<SnapshotGraphQLData | null> {
    // The caller may pass a customer slug or id — route it to the right
    // GraphQL argument (id is a UUID scalar and would reject a slug).
    const looksLikeId = UUID_RE.test(customer);
    let data = await this.graphqlRequest<LicensingSnapshotQuery>(
      LICENSING_SNAPSHOT_QUERY.toString(),
      looksLikeId ? { customerId: customer } : { customerSlug: customer },
    );
    if (!data.customer && looksLikeId) {
      // A UUID-shaped value can still be a SLUG (hosts often mirror their own
      // ids into slugs). Retry as a slug before conceding, so such orgs don't
      // silently lose the GraphQL path on every snapshot.
      data = await this.graphqlRequest<LicensingSnapshotQuery>(
        LICENSING_SNAPSHOT_QUERY.toString(),
        { customerSlug: customer },
      );
    }
    if (!data.customer) return null;

    const gqlCustomer = data.customer;
    const instances: Instance[] = [];
    const usageByInstance = new Map<string, EntitlementUsage[]>();

    for (const gqlInstance of gqlCustomer.instances) {
      instances.push({
        id: gqlInstance.id,
        slug: gqlInstance.slug,
        name: gqlInstance.name,
        description: gqlInstance.description,
        customerId: gqlInstance.customerId,
        customerSlug: gqlInstance.customerSlug,
        licenseId: gqlInstance.licenseId,
        licenseSlug: gqlInstance.licenseSlug,
        deploymentZoneId: gqlInstance.deploymentZoneId ?? undefined,
        startLicenseDate: gqlInstance.startLicenseDate,
        endLicenseDate: gqlInstance.endLicenseDate,
        metadata: (gqlInstance.metadata ?? {}) as Record<string, unknown>,
        createdBy: gqlInstance.createdBy,
        createdAt: gqlInstance.createdAt,
        updatedBy: gqlInstance.updatedBy,
        updatedAt: gqlInstance.updatedAt,
      });
      usageByInstance.set(gqlInstance.slug, gqlInstance.entitlementUsage.map(usageRowFromGraphql));
    }

    return {
      customer: {
        id: gqlCustomer.id,
        slug: gqlCustomer.slug,
        name: gqlCustomer.name,
        externalCustomerId: gqlCustomer.externalCustomerId ?? null,
        createdBy: gqlCustomer.createdBy,
        createdAt: gqlCustomer.createdAt,
        updatedBy: gqlCustomer.updatedBy,
        updatedAt: gqlCustomer.updatedAt,
      },
      instances,
      usageByInstance,
      catalog: catalogFromGqlLicenses(
        await this.collectGqlLicenses(data.licenses, "getLicensingSnapshot"),
      ),
    };
  }

  private assembleSnapshotGraphQL(
    data: SnapshotGraphQLData,
    customerId: string,
    instanceId: string | undefined,
    flags: ResolvedFeatureFlag[],
  ): LicensingSnapshot {
    const plans = normalizePlansResponse(data.catalog.plans);

    // Same selection semantics as the REST path: the explicit instance is
    // matched by SLUG only (the REST fallback resolves GET /instances/{slug} —
    // matching by id here would work until the first fallback, then 404). The
    // query already scopes the list to the customer, so "not in the list"
    // covers both wrong-customer and nonexistent.
    let instance: Instance | null = null;
    if (instanceId) {
      instance = data.instances.find((candidate) => candidate.slug === instanceId) ?? null;
      if (!instance) {
        throw new Error(
          `Instance "${instanceId}" not found for customer "${customerId}" (it does not exist or belongs to another customer).`,
        );
      }
    } else {
      instance = pickImplicitInstance(data.instances, customerId);
    }

    let license: License | null = null;
    let entitlements: ResolvedEntitlement[] = [];
    if (instance) {
      license = data.catalog.licensesBySlug.get(instance.licenseSlug) ?? null;
      // No `usageWindowUnknown` here: `LICENSING_SNAPSHOT_QUERY` now selects
      // `currentPeriodStart` / `currentPeriodEnd`, so an absent pair is the
      // entitlement's own answer ("lifetime counter") rather than a fact about
      // what the request bothered to ask for. That is the precondition the flag
      // was waiting on, and it is the only condition under which dropping it is
      // safe — reinstate it the moment this document stops selecting the bounds.
      entitlements = normalizeResolvedEntitlements(
        data.catalog.entitlementsByLicense.get(instance.licenseSlug) ?? [],
        data.usageByInstance.get(instance.slug) ?? [],
      );
    }

    return {
      source: "snapshot",
      plans,
      addOns: [],
      credits: [],
      entitlements,
      flags,
      actions: defaultActions(),
      capabilities: {
        paymentMethods: false,
        invoices: false,
        unsubscribe: false,
        checkout: false,
      },
      customer: data.customer,
      instance,
      license,
      licenseTerm: resolveLicenseTerm(instance),
      branding: normalizeBrandingCapability(undefined),
      updatedAt: new Date().toISOString(),
    };
  }

  // REST fallback: composed client-side from existing customer/instance/license/
  // usage endpoints (Option A, see ARCHITECTURE.md).
  private async getLicensingSnapshotRest(
    customerId: string,
    instanceId: string | undefined,
    flagsPromise: Promise<ResolvedFeatureFlag[]>,
    graphqlFailed = false,
  ): Promise<LicensingSnapshot> {
    // Customer, instance resolution and the plan catalog are independent — fetch
    // them in parallel. Plans = the full catalog so snapshot-derived upgrade
    // options / pricing work.
    // Customer + instance are the portal's identity and stay required (and the
    // belongs-to-customer check must throw). The remaining legs degrade to empty
    // on failure so one flaky endpoint — the catalog is the most request-heavy
    // (N+1), usage the most likely to be rate-limited — doesn't reject the whole
    // snapshot and blank the entire portal.
    // When GraphQL is what sent us here, don't ask it again for the catalog: the
    // round-trip is doomed and it would report a second degradation for one
    // event. When we're here for any other reason — an unknown customer — the
    // GraphQL catalog is still the better one to build, since the presentation
    // metadata (icons, units, sale units, groups) exists only on that path.
    const catalogPromise = graphqlFailed ? this.buildCatalogRest() : this.buildCatalog();

    const [customer, instance, catalog, flags] = await Promise.all([
      this.getCustomerByIdOrSlug(customerId),
      this.resolveSnapshotInstance(customerId, instanceId),
      catalogPromise.catch(() => this.emptyCatalog()),
      flagsPromise,
    ]);
    const plans = normalizePlansResponse(catalog.plans);

    let license: License | null = null;
    let entitlements: ResolvedEntitlement[] = [];

    if (instance) {
      // The instance's license is part of the org's license list, so reuse the
      // license + its entitlements already fetched by buildCatalog instead of
      // re-fetching them here; only fall back to a fetch if the catalog couldn't
      // supply them. Usage is always fetched live.
      const cachedLicense = catalog.licensesBySlug.get(instance.licenseSlug) ?? null;
      const cachedEntitlements = catalog.entitlementsByLicense.get(instance.licenseSlug);
      // A failed usage read is NOT "nothing consumed". Reporting it as zero left
      // every numeric quota looking empty, so no paywall fired and every check
      // said allowed — the strongest fail-open in the SDK, and invisible to the
      // host because nothing on this leg reported it. The failure is now both
      // announced (onDegraded) and carried into the entitlements, where
      // `usageUnavailable` makes consumers fail closed the way a failed
      // entitlement read already does.
      const [resolvedLicense, licenseEntitlements, usage] = await Promise.all([
        cachedLicense
          ? Promise.resolve(cachedLicense)
          : this.getLicense(instance.licenseSlug).catch((error: unknown) => {
              this.reportDegraded("getLicensingSnapshot.license", error);
              return null;
            }),
        cachedEntitlements
          ? Promise.resolve(cachedEntitlements)
          : this.listLicenseEntitlements(instance.licenseSlug).catch((error: unknown) => {
              this.reportDegraded("getLicensingSnapshot.entitlements", error);
              return [];
            }),
        this.getInstanceUsage(instance.slug).catch((error: unknown) => {
          this.reportDegraded("getLicensingSnapshot.usage", error);
          return USAGE_UNAVAILABLE;
        }),
      ]);
      license = resolvedLicense;
      const usageUnavailable = usage === USAGE_UNAVAILABLE;
      entitlements = normalizeResolvedEntitlements(
        licenseEntitlements,
        usageUnavailable ? null : (usage as EntitlementUsage[] | null),
        { usageUnavailable },
      );
    }

    return {
      source: "snapshot",
      plans,
      addOns: [],
      credits: [],
      entitlements,
      flags,
      actions: defaultActions(),
      capabilities: {
        paymentMethods: false,
        invoices: false,
        unsubscribe: false,
        checkout: false,
      },
      customer,
      instance,
      license,
      licenseTerm: resolveLicenseTerm(instance),
      branding: normalizeBrandingCapability(undefined),
      updatedAt: new Date().toISOString(),
    };
  }

  // Resolves the customer for the REST snapshot, by slug OR id.
  //
  // `GET /customers/{customerSlug}` addresses the customer by slug — the OpenAPI
  // says as much — while the GraphQL `customer` field takes either a slug or a
  // UUID. So a host that identifies its customers by id reads fine until the
  // snapshot falls back to REST, and then 404s: an intermittent failure that
  // reads as an outage rather than as the identifier mismatch it is.
  //
  // The slug attempt comes first and is usually the only one: a UUID-shaped
  // value can legitimately BE a slug (hosts mirror their own ids into slugs),
  // which is the same order the GraphQL path uses. Only a UUID-shaped value is
  // worth a second look, and only by id — a slug that 404s is genuinely absent.
  private async getCustomerByIdOrSlug(customerId: string): Promise<Customer> {
    try {
      return await this.getCustomer(customerId);
    } catch (error) {
      if (!UUID_RE.test(customerId)) throw error;
      // A scoped token gets 403 on the listing; then the original not-found is
      // the truthful error to surface, not a permissions one from the lookup.
      const customers = await this.listCustomers().catch(() => null);
      const matched = customers?.find((candidate) => candidate.id === customerId);
      if (!matched) throw error;
      return matched;
    }
  }

  // Resolves the instance for a snapshot: the explicit instance when given
  // (verified to belong to the customer), otherwise an implicit pick over the
  // customer's live instances. `customer` may be a customer slug or id, so
  // ownership is checked against both.
  private async resolveSnapshotInstance(
    customer: string,
    instanceSlug?: string,
  ): Promise<Instance | null> {
    const belongsToCustomer = (instance: Instance): boolean =>
      instance.customerSlug === customer || instance.customerId === customer;

    if (instanceSlug) {
      const instance = await this.getInstance(instanceSlug);
      if (!belongsToCustomer(instance)) {
        throw new Error(`Instance "${instanceSlug}" does not belong to customer "${customer}".`);
      }
      return instance;
    }

    // Filter first, then pick — `listInstances()` is the GLOBAL listing, so the
    // customer's own instances have to be selected out of it before the implicit
    // choice can match the GraphQL path's.
    const instances = (await this.listInstances()) ?? [];
    return pickImplicitInstance(instances.filter(belongsToCustomer), customer);
  }

  getInstanceUsage(instanceSlug: string): Promise<EntitlementUsage[] | null> {
    return this.transport.run(
      (client) =>
        getEntitlementsUsageMetrics({
          client,
          path: { instanceSlug },
        }),
      `getInstanceUsage(${instanceSlug})`,
    );
  }

  getInstanceEntitlementUsage(
    instanceSlug: string,
    entitlementSlug: string,
  ): Promise<EntitlementUsage> {
    return this.transport.run(
      (client) =>
        getEntitlementUsageMetrics({
          client,
          path: { instanceSlug, entitlementSlug },
        }),
      `getInstanceEntitlementUsage(${instanceSlug}, ${entitlementSlug})`,
    );
  }

  reportUsage(
    instanceSlug: string,
    entitlementSlug: string,
    input: ReportUsageInput,
  ): Promise<EntitlementUsage> {
    return this.transport.run(
      (client) =>
        reportEntitlementUsageMetric({
          client,
          path: { instanceSlug, entitlementSlug },
          body: input,
        }),
      `reportUsage(${instanceSlug}, ${entitlementSlug})`,
      // Never replayed. The endpoint carries no idempotency key, so a retry
      // after a timeout that the server had already committed would count the
      // same consumption twice — and this counter is the billing base.
      { idempotent: false },
    );
  }

  getEntitlementGroupUsage(
    groupSlug: string,
    instanceSlug: string,
  ): Promise<EntitlementGroupUsageItem[] | null> {
    return this.transport.run(
      (client) =>
        getEntitlementGroupUsage({
          client,
          path: { entitlementGroupSlug: groupSlug },
          query: { instance: instanceSlug },
        }),
      `getEntitlementGroupUsage(${groupSlug}, ${instanceSlug})`,
    );
  }

  evaluateFlag(key: string, context?: Record<string, unknown>): Promise<EvaluationSuccess> {
    return this.transport.run(
      (client) =>
        evaluateFlagApi({
          client,
          path: { key },
          body: { context: context ?? {} },
        }),
      `evaluateFlag(${key})`,
    );
  }

  async evaluateFlags(context?: Record<string, unknown>): Promise<BulkEvaluationResponse> {
    const response = await this.transport.run<{ flags?: BulkEvaluationResponse["flags"] }>(
      (client) =>
        evaluateFlagsBulk({
          client,
          body: { context: context ?? {} },
        }),
      "evaluateFlags()",
    );

    return {
      flags: response.flags ?? [],
    };
  }
}
