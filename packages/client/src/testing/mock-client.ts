import type { KaitenClientLike } from "../client/client.ts";
import type {
  BulkEvaluationResponse,
  EntitlementUsage,
  EvaluationSuccess,
  KaitenCatalog,
  LicensingSnapshot,
  ReportUsageInput,
  ResolvedEntitlement,
  ResolvedFeatureFlag,
} from "../client/types.ts";
import { demoCatalog, demoSnapshot } from "./fixtures.ts";

export interface MockKaitenClientOptions {
  /** Catalog returned by `getCatalog()` (public mode). Defaults to `demoCatalog()`. */
  catalog?: KaitenCatalog;
  /** Snapshot returned by `getLicensingSnapshot()`. Defaults to `demoSnapshot()`. */
  snapshot?: LicensingSnapshot;
  /**
   * Delay every call by this many milliseconds, so loading skeletons are
   * observable instead of flashing past.
   */
  delayMs?: number;
  /**
   * Reject every call with this error, to drive failure states — `KaitenFailed`,
   * a section's retry affordance, `Show`'s `onError` policy.
   */
  error?: Error;
  /** Notified on `reportUsage`, for asserting a component reported what it should. */
  onReportUsage?: (instanceSlug: string, entitlementSlug: string, input: ReportUsageInput) => void;
}

export interface MockKaitenClient extends KaitenClientLike {
  /** The live snapshot, including any usage reported since. */
  readonly snapshot: LicensingSnapshot;
  /** Replaces the snapshot mid-scenario — an upgrade landing, a quota topped up. */
  setSnapshot: (snapshot: LicensingSnapshot) => void;
  /** Replaces the catalog mid-scenario. */
  setCatalog: (catalog: KaitenCatalog) => void;
  /** Every `reportUsage` call, oldest first. */
  readonly usageReports: {
    instanceSlug: string;
    entitlementSlug: string;
    input: ReportUsageInput;
  }[];
}

function flagToEvaluation(flag: ResolvedFeatureFlag): EvaluationSuccess {
  return {
    key: flag.key,
    value: flag.value,
    variant: flag.variant,
    reason: flag.reason,
    metadata: flag.metadata,
  } as EvaluationSuccess;
}

// Re-derives the fields the snapshot normalizer computes, so a reported usage
// moves the meter, the percentage and the status together. A fake that updated
// only `currentValue` would let a component look correct against it and wrong
// against the API.
function applyUsage(
  entitlement: ResolvedEntitlement,
  input: ReportUsageInput,
): ResolvedEntitlement {
  if (entitlement.limitValue.type !== "number" || input.value.type !== "number") {
    return { ...entitlement, currentValue: input.value };
  }

  const previous = entitlement.currentValue?.type === "number" ? entitlement.currentValue.value : 0;
  const current = input.behavior === "set" ? input.value.value : previous + input.value.value;
  const limit = entitlement.limitValue.value;
  // What the API accepts, which a soft limit puts above the included value.
  const ceiling = entitlement.maximumAllowedUsage ?? limit;

  if (entitlement.unlimited) {
    return {
      ...entitlement,
      currentValue: { type: "number", value: current },
      remaining: null,
      percentageUsed: null,
      status: "enabled",
    };
  }

  return {
    ...entitlement,
    currentValue: { type: "number", value: current },
    remaining: Math.max(ceiling - current, 0),
    percentageUsed: limit > 0 ? (current / limit) * 100 : null,
    status:
      current >= ceiling
        ? "over_limit"
        : limit > 0 && current / limit >= 0.8
          ? "near_limit"
          : "enabled",
  };
}

/**
 * A `KaitenClient` backed by in-memory fixtures instead of an API.
 *
 * Building a UI against Kaiten used to require a Kaiten account and a reachable
 * API — the first friction of adoption, and an outright blocker for an
 * end-to-end test. Anything typed `KaitenClientLike` takes this instead.
 *
 * ```ts
 * import { createMockKaitenClient } from "@kaitencloud/client/testing";
 *
 * const client = createMockKaitenClient();
 * const catalog = await client.getCatalog();
 * ```
 *
 * It is a fake, not a stub: `reportUsage` moves the usage it reports, so meters,
 * percentages and `near_limit`/`over_limit` transitions behave as they will
 * against the real API. Pass `delayMs` to hold loading states still, or `error`
 * to drive failure states.
 */
export function createMockKaitenClient(options: MockKaitenClientOptions = {}): MockKaitenClient {
  let catalog = options.catalog ?? demoCatalog();
  let snapshot = options.snapshot ?? demoSnapshot();
  const usageReports: MockKaitenClient["usageReports"] = [];

  async function settle(): Promise<void> {
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.error) throw options.error;
  }

  return {
    get snapshot() {
      return snapshot;
    },
    get usageReports() {
      return usageReports;
    },
    setSnapshot(next) {
      snapshot = next;
    },
    setCatalog(next) {
      catalog = next;
    },

    async getCatalog(): Promise<KaitenCatalog> {
      await settle();
      return catalog;
    },

    async getLicensingSnapshot(): Promise<LicensingSnapshot> {
      await settle();
      return snapshot;
    },

    async evaluateFlag(key: string): Promise<EvaluationSuccess> {
      await settle();
      const flag = snapshot.flags.find((candidate) => candidate.key === key);
      // Unknown flags evaluate to the off default rather than throwing — the
      // same fail-closed answer OFREP gives for a flag the org never defined.
      return flag
        ? flagToEvaluation(flag)
        : ({ key, value: false, reason: "DEFAULT" } as EvaluationSuccess);
    },

    async evaluateFlags(): Promise<BulkEvaluationResponse> {
      await settle();
      return { flags: snapshot.flags.map(flagToEvaluation) };
    },

    async reportUsage(
      instanceSlug: string,
      entitlementSlug: string,
      input: ReportUsageInput,
    ): Promise<EntitlementUsage> {
      await settle();
      usageReports.push({ instanceSlug, entitlementSlug, input });
      options.onReportUsage?.(instanceSlug, entitlementSlug, input);

      snapshot = {
        ...snapshot,
        entitlements: snapshot.entitlements.map((entitlement) =>
          entitlement.slug === entitlementSlug ? applyUsage(entitlement, input) : entitlement,
        ),
      };

      const updated = snapshot.entitlements.find(
        (entitlement) => entitlement.slug === entitlementSlug,
      );

      // The window is carried, not recomputed. A report that lands inside the
      // current window leaves its bounds alone, which is the server's behaviour;
      // rolling one over is triggered server-side by the report crossing the
      // boundary, and this fake does not simulate it — it has no clock and no
      // reset period to roll against. So: same window in, same window out.
      //
      // `entitlementId` is the normalizer's composite `licenseSlug:slug`, not the
      // entitlement UUID the API returns. Anything asserting on that field
      // against this fake is asserting on the fake.
      const usage: EntitlementUsage = {
        entitlementId: updated?.id ?? entitlementSlug,
        entitlementSlug,
        licenseId: snapshot.license?.id ?? "",
        licenseSlug: snapshot.license?.slug ?? "",
        value: (updated?.currentValue ?? input.value) as EntitlementUsage["value"],
        ...(updated?.currentPeriodStart ? { currentPeriodStart: updated.currentPeriodStart } : {}),
        ...(updated?.currentPeriodEnd ? { currentPeriodEnd: updated.currentPeriodEnd } : {}),
      };
      return usage;
    },
  };
}
