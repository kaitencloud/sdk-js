const PUBLISHABLE_KEY_PREFIX = "pk_";

/**
 * Credential prefixes that must never reach a browser.
 *
 * - `ksh_` — an organization-scoped personal access token. It was missing once,
 *   so a leaked one was reported as an "invalid publishable key format", a
 *   message that tells nobody a full-rights credential is in their bundle.
 * - `ksm_` — the Platform API credential. It
 *   authenticates `system:kaiten` and carries *no* organization, so it is not a
 *   wider `ksh_`: it is a different class, and in a bundle it is strictly worse
 *   than one, because it reaches every tenant rather than one. It fell into the
 *   same wrong message `ksh_` used to.
 * - `sk_` — reserved for the secret key of a future in-app mode, not issued
 *   yet.
 *
 * The two `ks*_` families are listed separately rather than matched as a
 * `ks[hm]_` class because the error names the prefix it actually saw, and those
 * two prefixes do not call for the same reaction from whoever reads it.
 *
 * This guard catches a developer's mistake. It is not a security boundary:
 * anything that reaches a browser is already public, and a credential that got
 * this far has to be rotated, not caught.
 */
const SECRET_KEY_PREFIXES = ["sk_", "ksh_", "ksm_"] as const;

export function isPublishableKey(key: string = ""): boolean {
  return key.startsWith(PUBLISHABLE_KEY_PREFIX);
}

/** The secret prefix a credential starts with, if any. */
export function secretKeyPrefix(key: string = ""): string | null {
  return SECRET_KEY_PREFIXES.find((prefix) => key.startsWith(prefix)) ?? null;
}

/** True in a browser-like runtime — where a secret credential is a leak. */
export function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}

export function assertPublishableKey(key: string): void {
  if (!key) {
    throw new Error("Kaiten: publishableKey is missing. Get your key from the Kaiten dashboard.");
  }

  const secret = secretKeyPrefix(key);
  if (secret) {
    throw new Error(
      `Kaiten: You are using a secret key (${secret}*) in the browser. Use a publishable key (pk_*) instead.`,
    );
  }

  if (!isPublishableKey(key)) {
    throw new Error("Kaiten: Invalid publishable key format. Keys should start with 'pk_'.");
  }
}
