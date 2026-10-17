// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * SWR keys for everything the SDK reads.
 *
 * **Every key is scoped.** The first segment after `"kaiten"` is the provider's
 * `scopeKey` — `public:apiUrl:publishableKey`,
 * `authenticated:apiUrl:customerId:instanceId`, `customer-session:…` or
 * `static:<plan slugs>`, the
 * same string that decides whether a nested `<KaitenProvider>` is a redundant
 * duplicate or a second, intentional scope. (A static provider registers no
 * key here: it reads nothing, so there is nothing to cache.)
 *
 * That prefix is what makes a shared SWR cache safe. The feature-flag keys used
 * to be `["kaiten", "feature-flag", key]` with nothing identifying the scope, so
 * two providers pointed at different customers — a case the SDK explicitly
 * supports, and warns about when it is *not* intentional — served each other
 * their evaluations: whichever mounted first decided what the other saw. The
 * catalog key already carried `(apiUrl, publishableKey)` for exactly this
 * reason; the rest did not.
 *
 * Scoping the keys is deliberately preferred over giving the SDK its own cache
 * via `<SWRConfig provider>`. A cache provider on a context that wraps the
 * host's children would capture the host's own `useSWR` calls too, cutting them
 * off from the cache their hooks outside the provider use — trading this bug for
 * a worse one. Distinct keys in one cache isolate the SDK's data without
 * touching anyone else's, and still let two providers in the *same* scope share
 * a single fetch.
 *
 * Take `scopeKey` from `useKaitenContext()`. It is exported so a host can
 * `mutate()` the SDK's entries; the keys here are exactly the ones in the cache.
 */
export const kaitenKeys = {
  all: ["kaiten"] as const,

  /** Everything this provider scope owns — the prefix of every key below. */
  scope: (scopeKey: string) => ["kaiten", scopeKey] as const,

  components: {
    catalog: (scopeKey: string) => ["kaiten", scopeKey, "components", "catalog"] as const,
    snapshot: (scopeKey: string) => ["kaiten", scopeKey, "components", "snapshot"] as const,
    /** A customer session's portal, under `mode="customer-session"`. */
    portal: (scopeKey: string) => ["kaiten", scopeKey, "components", "portal"] as const,
  },

  featureFlag: {
    detail: (scopeKey: string, key: string) => ["kaiten", scopeKey, "feature-flag", key] as const,
    bulk: (scopeKey: string) => ["kaiten", scopeKey, "feature-flags", "bulk"] as const,
  },
} as const;
