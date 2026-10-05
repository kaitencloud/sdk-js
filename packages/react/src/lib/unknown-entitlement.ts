/** Warn once per (hook, slug) — the entitlement hooks re-run on every poll. */
const warned = new Set<string>();

function isProduction(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "production";
}

/**
 * Says, in development, that an entitlement slug matched nothing.
 *
 * A slug the org does not define resolves to `allowed: false`. That is the
 * correct answer — gating must fail closed, never reveal a feature because a
 * lookup missed — but it is indistinguishable from a genuinely denied
 * entitlement, so a typo in `<Show entitlement="api_calls_">` presents as a
 * feature that is simply switched off. Nothing to inspect, nothing in the
 * console, and the fix is a character.
 *
 * The known slugs are listed because that is what turns the message into the
 * answer rather than another question.
 *
 * Deliberately silent in three cases, each of which is "not found YET" rather
 * than "not found":
 *
 * - while the snapshot is loading, when nothing is known;
 * - when the read failed, since the list is missing rather than complete;
 * - for an empty slug, which is how `Show` calls the entitlement hook on its
 *   flag-condition branch.
 */
export function warnUnknownEntitlement(options: {
  hook: string;
  slug: string;
  known: readonly string[] | null | undefined;
  isLoading: boolean;
  error: unknown;
}): void {
  const { hook, slug, known, isLoading, error } = options;

  if (isProduction()) return;
  if (!slug || isLoading || error || !known) return;
  if (known.includes(slug)) return;

  const key = `${hook}:${slug}`;
  if (warned.has(key)) return;
  warned.add(key);

  console.warn(
    `[@kaitencloud/react] ${hook}("${slug}"): no entitlement with that slug is granted by the ` +
      `current license, so it resolves to "not allowed" (fail-closed). ` +
      (known.length
        ? `Available slugs: ${known.join(", ")}.`
        : `The current license grants no entitlements at all.`),
  );
}
