// @kaitencloud/client — Kaiten JavaScript client SDK.
//
// Plumbing (generated client, transport, runtime primitives, config types)
// lives in ./core. The curated client surface and the embedded-component /
// domain types live beside it.

// The ~8000 lines of generated OpenAPI types/operations live under a
// `KaitenApi` namespace instead of flooding the top-level (collisions, snake_case
// leaks). Curated types are still promoted to the top level individually (here,
// and via ./client/types.ts which cherry-picks the few generated types the SDK
// surface exposes). Reach a raw generated type with `KaitenApi.*`.
export * as KaitenApi from "./core/index.ts";

// Curated runtime + config surface, promoted back to the top level:
export {
  client,
  KaitenError,
  KaitenNetworkError,
  KaitenTransport,
  assertPublishableKey,
  isPublishableKey,
  retry,
} from "./core/index.ts";
export type {
  AuthenticatedKaitenProviderConfig,
  CreateClientConfig,
  KaitenApiError,
  KaitenAuthScheme,
  KaitenClientConfig,
  KaitenFetch,
  KaitenPollingConfig,
  KaitenProviderConfig,
  KaitenThrownError,
  PublicKaitenProviderConfig,
  RetryOptions,
} from "./core/index.ts";

export { KaitenClient } from "./client/client.ts";
export type {
  KaitenClientLike,
  KaitenComponentsModule,
  KaitenCustomersModule,
  KaitenFlagsModule,
  KaitenInstancesModule,
  KaitenLicensesModule,
  KaitenUsageModule,
} from "./client/client.ts";
export {
  defaultActions,
  normalizeBrandingCapability,
  normalizePlanPrices,
  normalizePlansResponse,
  normalizeResolvedEntitlements,
  // Exported for the same reason as the normaliser above: a test double or a host
  // assembling its own snapshot has to derive the licence term the way the client
  // does, and hand-rolling it is how a fixture ends up missing the field entirely.
  resolveLicenseTerm,
  withQuery,
} from "./client/normalize.ts";
export { isEvaluationFailure, isEvaluationSuccess } from "./client/feature-flags.ts";
export type { FeatureFlagEvaluation } from "./client/feature-flags.ts";
// An entitlement business rule shared by every usage surface, not infrastructure
// — hence a domain module rather than a `lib/` helper. Exported because a host
// rendering its own meters needs the same rule the SDK's components use, and the
// alternative is each host re-deriving "both bounds or it is not a window".
export {
  getMaximumAllowedUsage,
  getUsageScope,
  isPeriodicEntitlement,
  isSoftLimit,
  isUnlimitedThreshold,
  resolveUsageScope,
  UNLIMITED_THRESHOLD,
} from "./domain/entitlement-usage.ts";
export type {
  ResolvedUsageScope,
  UsageScope,
  UsageWindowBounds,
} from "./domain/entitlement-usage.ts";

// Embedded-component and SDK domain types (curated). `client/types.ts` defines
// the domain types AND cherry-picks the handful of generated types the SDK
// surface exposes (entitlement value types, evaluation types, `User`, …) — those
// are the curated subset that stays top-level; the rest of the generated surface
// is under `KaitenApi`. Some names intentionally override the generated ones.
export type * from "./client/types.ts";
