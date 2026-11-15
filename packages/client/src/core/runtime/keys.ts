// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

const PUBLISHABLE_KEY_PREFIX = "pk_";

/**
 * The prefix of a checkout session token, the credential of one anonymous
 * checkout. A third class beside the publishable key (`pk_`) and the customer
 * session (`kst_`): the three are disjoint, and the API refuses one presented on
 * the routes of another.
 */
export const CHECKOUT_SESSION_TOKEN_PREFIX = "ksc_";

/**
 * Credential prefixes that must never reach a browser.
 *
 * - `ksh_` — an organization-scoped access token. It was missing once,
 *   so a leaked one was reported as an "invalid publishable key format", a
 *   message that tells nobody a full-rights credential is in their bundle.
 * - `ksm_` — the Platform API credential. It
 *   authenticates `system:kaiten` and carries *no* organization, so it is not a
 *   wider `ksh_`: it is a different class, and in a bundle it is strictly worse
 *   than one, because it reaches every organization rather than one. It fell
 *   into the same wrong message `ksh_` used to.
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

/**
 * True for a checkout session token (`ksc_…`), the credential `startCheckout`
 * obtains for one anonymous checkout: a bearer credential for one session, which
 * reads and confirms that session and nothing else. Do not log or share it. It is
 * not a publishable key or a customer session either, and none of the three is
 * accepted where another is expected.
 */
export function isCheckoutSessionToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.startsWith(CHECKOUT_SESSION_TOKEN_PREFIX) &&
    token.length > CHECKOUT_SESSION_TOKEN_PREFIX.length
  );
}

export function isPublishableKey(key: string = ""): boolean {
  return key.startsWith(PUBLISHABLE_KEY_PREFIX);
}

/**
 * A publishable key as Kaiten issues it: `pk_` and 43 random base64url
 * characters. `isPublishableKey` only reads the prefix and stays lenient, because
 * it has long accepted any `pk_` string and a test key such as `pk_live_abc` is
 * how many hosts have written theirs.
 */
const PUBLISHABLE_KEY_SHAPE = /^pk_[A-Za-z0-9_-]{43}$/;

/** True for a string of the shape Kaiten issues publishable keys in. */
export function isPublishableKeyShape(key: unknown): boolean {
  return typeof key === "string" && PUBLISHABLE_KEY_SHAPE.test(key);
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

/**
 * Like `assertPublishableKey`, and stricter: a key that has the right prefix but
 * not the shape of a key Kaiten issued (cut short by a paste, quoted, padded
 * with a space) is refused too. Use it where a mistyped key should fail at once,
 * with a message that says so, instead of as a 401 from the API; the client's
 * own requests keep the lenient check.
 */
export function assertPublishableKeyShape(key: string): void {
  assertPublishableKey(key);

  if (!isPublishableKeyShape(key)) {
    throw new Error(
      "Kaiten: Malformed publishable key. A key is 'pk_' followed by 43 letters, digits, '-' or '_'. " +
        "Check that it was copied whole.",
    );
  }
}
