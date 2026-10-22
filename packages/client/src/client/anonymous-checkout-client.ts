// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The client of the anonymous checkout, `/public/checkout-sessions`: what a browser
// does for a visitor the vendor's backend does not know yet, with a publishable key
// and a Turnstile token. A class of its own rather than more methods on
// `KaitenClient`: it holds two credentials of two classes that must never reach
// each other's routes, the publishable key to start and the `ksc_` token of one
// session to read and confirm it, and a host that offers no checkout does not ship
// its code.

import type {
  KaitenAnonymousCheckoutClientConfig,
  KaitenCheckoutCredential,
  KaitenCheckoutTokenStorage,
} from "../core/config.ts";
import {
  resolveApiBaseUrl,
  resolveFetchImplementation,
  retryable,
  retryAfterDelay,
  sendPublic,
} from "../core/http.ts";
import {
  CheckoutSessionClosedError,
  CheckoutTokenMissingError,
  KaitenError,
} from "../core/runtime/errors.ts";
import { assertPublishableKey, isCheckoutSessionToken } from "../core/runtime/keys.ts";
import { retry } from "../core/runtime/retry.ts";
import type {
  CheckoutConfirmation as WireConfirmation,
  CheckoutSession as WireSession,
  CheckoutSessionStart as WireStart,
} from "../core/index.ts";
import {
  mapCheckoutConfirmation,
  mapCheckoutSession,
  mapCheckoutSessionStart,
} from "./anonymous-checkout-mapping.ts";
import type {
  CheckoutConfirmation,
  CheckoutSession,
  CheckoutSessionStart,
  StartCheckoutInput,
} from "./anonymous-checkout-types.ts";

/**
 * What a client does for an anonymous checkout: the `/public/checkout-sessions`
 * routes, for a page that sells a plan to a visitor with no account.
 *
 * `KaitenAnonymousCheckoutClient` implements it. A separate interface from
 * `KaitenClientLike`, which hosts implement and which therefore cannot gain a
 * member in 1.x: a host's own client or double opts in by implementing this one.
 */
export interface KaitenAnonymousCheckoutClientLike {
  /**
   * Starts a checkout with a Turnstile token, or, with `dryRun`, computes what it
   * would bill. A real start opens a session; the client keeps its token.
   */
  startCheckout: (input: StartCheckoutInput) => Promise<CheckoutSessionStart>;
  /** Reads a session: its status, what is due and, once completed, the customer and instance created. */
  getCheckoutSession: (sessionId: string) => Promise<CheckoutSession>;
  /**
   * Confirms a session. It completes at once when nothing has to be paid, and
   * otherwise answers a hosted page that saves a payment method (call it again on
   * the way back) and then the payment's progress.
   */
  confirmCheckout: (sessionId: string) => Promise<CheckoutConfirmation>;
  /** Whether the client holds the token of that session, and so can read and confirm it. */
  holdsCheckoutSession: (sessionId: string) => boolean;
  /** Drops the token of that session. A session that closed is dropped by the client itself. */
  forgetCheckoutSession: (sessionId: string) => void;
}

/** The query member the hosted setup page brings the visitor back with. */
export const CHECKOUT_RETURN_PARAM = "kaiten_checkout_session";

/**
 * The checkout session a return URL names. The hosted setup page sends the visitor
 * back to the `returnUrl` of the start with `kaiten_checkout_session=<sessionId>`
 * added, and never the token. Returns that id and the URL without it, which a page
 * puts back in the address bar (`history.replaceState`) so that a reload does not
 * confirm again; `null` when the URL names no session.
 *
 * Reads `location.href` when it is given no URL.
 */
export function readCheckoutReturn(
  url?: string | URL,
): { sessionId: string; urlWithoutSession: string } | null {
  const base = globalThis.location?.href;
  const href = url ?? base;
  if (href === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(href, base);
  } catch {
    return null;
  }
  const sessionId = parsed.searchParams.get(CHECKOUT_RETURN_PARAM);
  if (!sessionId || sessionId.length > 256) return null;
  parsed.searchParams.delete(CHECKOUT_RETURN_PARAM);
  return { sessionId, urlWithoutSession: parsed.toString() };
}

/** The statuses after which a session never changes. */
const CLOSED: ReadonlySet<string> = new Set(["COMPLETED", "ABANDONED", "EXPIRED"]);

const STORAGE_KEY_PREFIX = "kaiten.checkout.";

/** `sessionStorage` when the runtime has one and lets this page use it. */
function defaultStorage(): KaitenCheckoutTokenStorage | undefined {
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    // Blocked storage throws on access.
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Fields of the body of a start that are strings, and not empty when sent. */
const STRING_FIELDS = [
  "priceId",
  "licenseSlug",
  "billingPeriod",
  "voucherCode",
  "email",
  "returnUrl",
  "clientReferenceId",
] as const;

/**
 * Refuses, before a Turnstile token is spent, a start the API would refuse for its
 * shape. The token is single-use: a start that fails on the choice of the price
 * has already used it up.
 */
function startBody(input: StartCheckoutInput): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new TypeError("Kaiten: startCheckout needs an input object.");
  }
  if (typeof input.turnstileToken !== "string" || input.turnstileToken === "") {
    throw new TypeError("Kaiten: startCheckout needs the turnstileToken the widget gave the page.");
  }
  for (const field of STRING_FIELDS) {
    const value = input[field];
    if (value !== undefined && (typeof value !== "string" || value === "")) {
      throw new TypeError(`Kaiten: startCheckout ${field} must be a non-empty string.`);
    }
  }
  const byPrice = input.priceId !== undefined;
  const byPlan = input.licenseSlug !== undefined || input.billingPeriod !== undefined;
  if (byPrice === byPlan || (byPlan && (!input.licenseSlug || !input.billingPeriod))) {
    throw new TypeError(
      "Kaiten: startCheckout needs priceId, or licenseSlug with billingPeriod, and not both.",
    );
  }
  if ((input.clientReferenceId?.length ?? 0) > 255) {
    throw new TypeError("Kaiten: startCheckout clientReferenceId is at most 255 characters.");
  }
  if (input.dryRun !== true && (input.email === undefined || input.returnUrl === undefined)) {
    throw new TypeError("Kaiten: startCheckout needs email and returnUrl, unless it is a dryRun.");
  }
  if (input.addOns !== undefined) {
    const valid =
      Array.isArray(input.addOns) &&
      input.addOns.every(
        (addOn) =>
          isRecord(addOn) &&
          typeof addOn.addonSlug === "string" &&
          addOn.addonSlug !== "" &&
          Number.isInteger(addOn.quantity) &&
          addOn.quantity >= 1,
      );
    if (!valid) {
      throw new TypeError(
        "Kaiten: startCheckout addOns must be a list of { addonSlug, quantity }, with a whole quantity of 1 or more.",
      );
    }
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, unknown>;
}

const invalidSessionId = (method: string) =>
  new TypeError(`Kaiten: ${method} needs the sessionId startCheckout gave.`);

/**
 * The anonymous checkout client.
 *
 * ```ts
 * const checkout = new KaitenAnonymousCheckoutClient({
 *   apiUrl: "https://kaiten.example.com/api",
 *   publishableKey: "pk_…",
 * });
 * const started = await checkout.startCheckout({
 *   turnstileToken, // from the Turnstile widget, one per start
 *   licenseSlug: "growth-v1",
 *   billingPeriod: "MONTHLY",
 *   email: "ada@example.com",
 *   returnUrl: "https://shop.example.com/welcome",
 * });
 * const confirmation = await checkout.confirmCheckout(started.sessionId);
 * if (confirmation.status === "requires_payment_method") location.assign(confirmation.setupUrl);
 * ```
 *
 * **Two credentials, two routes.** The publishable key goes in
 * `X-Kaiten-Publishable-Key` to the route that starts a checkout and nowhere else.
 * The start answers the session's `ksc_` token, which goes in
 * `Authorization: Bearer ksc_…` to that session's own two routes and nowhere else.
 * Neither is ever sent with the other, whatever `defaultHeaders` holds, and no
 * cookie is sent.
 *
 * **The token** stays with the client: in memory and in `sessionStorage`, under the
 * session's id, because the payment method setup is a full-page redirect and the
 * page that comes back must still be able to confirm. It is never in a URL and never
 * in `localStorage`, and it is dropped when the session closes or the API refuses
 * it. {@link readCheckoutReturn} reads the session's id from the return URL.
 *
 * A read is replayed after a network failure or a 5xx, after the `Retry-After` the
 * API sent if it sent one (at most 30 seconds). A write never is, the start
 * included: its Turnstile token is spent. A refusal keeps the API's `status`,
 * `code` and `retryAfterSeconds`.
 */
export class KaitenAnonymousCheckoutClient implements KaitenAnonymousCheckoutClientLike {
  private readonly config: KaitenAnonymousCheckoutClientConfig;
  private readonly baseUrl: string;
  private readonly fetchImpl: NonNullable<KaitenAnonymousCheckoutClientConfig["fetch"]>;
  private readonly storage: KaitenCheckoutTokenStorage | undefined;
  private readonly tokens = new Map<string, string>();
  /** The last answer for each session seen closed: a closed session never changes. */
  private readonly closed = new Map<string, CheckoutSession>();

  constructor(config: KaitenAnonymousCheckoutClientConfig) {
    assertPublishableKey(config.publishableKey);
    this.config = config;
    this.baseUrl = resolveApiBaseUrl(config.apiUrl);
    this.fetchImpl = resolveFetchImplementation(config.fetch);
    this.storage = config.storage === undefined ? defaultStorage() : (config.storage ?? undefined);
  }

  async startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart> {
    const body = startBody(input);
    const label = input.dryRun === true ? "startCheckout(dryRun)" : "startCheckout()";
    const headers = this.headers();
    headers.set("X-Kaiten-Publishable-Key", this.config.publishableKey);
    const raw = await this.guarded(
      sendPublic<WireStart>(
        this.fetchImpl,
        `${this.baseUrl}/public/checkout-sessions`,
        { method: "POST", headers, body, timeoutMs: this.config.timeoutMs },
        label,
      ),
      label,
    );

    if (raw.status === "open") {
      if (typeof raw.sessionId !== "string" || !isCheckoutSessionToken(raw.token)) {
        throw new KaitenError({
          title: "Malformed checkout session",
          status: 0,
          detail: "Kaiten: the API opened a checkout session without its id or its ksc_ token.",
        });
      }
      this.remember({ sessionId: raw.sessionId, token: raw.token });
    }
    return mapCheckoutSessionStart(raw);
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession> {
    if (typeof sessionId !== "string" || sessionId === "")
      throw invalidSessionId("getCheckoutSession");
    const known = this.closed.get(sessionId);
    if (known) return structuredClone(known);

    const label = `getCheckoutSession(${sessionId})`;
    const token = this.tokenOf(sessionId);
    const raw = await this.guarded(
      retry(
        () =>
          sendPublic<WireSession>(
            this.fetchImpl,
            this.sessionUrl(sessionId),
            { method: "GET", headers: this.bearer(token), timeoutMs: this.config.timeoutMs },
            label,
          ),
        {
          retryImmediately: true,
          shouldRetry: (error, iteration) => retryable(true, error, iteration),
          delayOf: retryAfterDelay,
        },
      ),
      label,
      sessionId,
    );
    return this.seen(mapCheckoutSession(raw));
  }

  async confirmCheckout(sessionId: string): Promise<CheckoutConfirmation> {
    if (typeof sessionId !== "string" || sessionId === "")
      throw invalidSessionId("confirmCheckout");
    const known = this.closed.get(sessionId);
    if (known) throw this.closedError(known.status);

    const label = `confirmCheckout(${sessionId})`;
    const token = this.tokenOf(sessionId);
    const raw = await this.guarded(
      sendPublic<WireConfirmation>(
        this.fetchImpl,
        `${this.sessionUrl(sessionId)}/confirm`,
        { method: "POST", headers: this.bearer(token), timeoutMs: this.config.timeoutMs },
        label,
      ),
      label,
      sessionId,
    );
    const confirmation = mapCheckoutConfirmation(raw);
    if (isRecord(confirmation.session)) this.seen(confirmation.session);
    return confirmation;
  }

  holdsCheckoutSession(sessionId: string): boolean {
    return typeof sessionId === "string" && this.recall(sessionId) !== undefined;
  }

  forgetCheckoutSession(sessionId: string): void {
    this.tokens.delete(sessionId);
    try {
      this.storage?.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    } catch {
      // Storage that refuses a removal has nothing the client can do about it.
    }
  }

  private sessionUrl(sessionId: string): string {
    return `${this.baseUrl}/public/checkout-sessions/${encodeURIComponent(sessionId)}`;
  }

  /** The headers of the host, without any credential: each call adds its own. */
  private headers(): Headers {
    const headers = new Headers(this.config.defaultHeaders);
    headers.delete("Authorization");
    headers.delete("X-Kaiten-Publishable-Key");
    return headers;
  }

  private bearer(token: string): Headers {
    const headers = this.headers();
    headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  /**
   * Tells the host the API refused a credential and forgets the session's token,
   * which nothing can renew, then hands the error back. A 409 `SessionClosed`
   * leaves the token: the session is read once more to learn how it closed.
   */
  private async guarded<T>(call: Promise<T>, label: string, sessionId?: string): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (error instanceof KaitenError && (error.status === 401 || error.status === 403)) {
        if (sessionId !== undefined && error.status === 401) this.forgetCheckoutSession(sessionId);
        this.config.onAuthError?.({ status: error.status, operation: label, error });
      }
      throw error;
    }
  }

  private remember(credential: KaitenCheckoutCredential): void {
    this.tokens.set(credential.sessionId, credential.token);
    try {
      this.storage?.setItem(
        `${STORAGE_KEY_PREFIX}${credential.sessionId}`,
        JSON.stringify(credential),
      );
    } catch {
      // Full or blocked storage: the token lives in memory, and a redirect loses it.
    }
  }

  /** The token held for a session: from memory, else from the storage a redirect left it in. */
  private recall(sessionId: string): string | undefined {
    const held = this.tokens.get(sessionId);
    if (held) return held;
    try {
      const stored: unknown = JSON.parse(
        this.storage?.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`) ?? "null",
      );
      if (
        isRecord(stored) &&
        stored["sessionId"] === sessionId &&
        isCheckoutSessionToken(stored["token"])
      ) {
        this.tokens.set(sessionId, stored["token"]);
        return stored["token"];
      }
    } catch {
      // Unreadable storage, or a value that is not ours: no token.
    }
    return undefined;
  }

  private tokenOf(sessionId: string): string {
    const token = this.recall(sessionId);
    if (!token) throw new CheckoutTokenMissingError(sessionId);
    return token;
  }

  /** Remembers a session that closed, and drops its token: it acts on nothing from then on. */
  private seen(session: CheckoutSession): CheckoutSession {
    if (CLOSED.has(session.status)) {
      this.closed.set(session.sessionId, structuredClone(session));
      this.forgetCheckoutSession(session.sessionId);
    }
    return session;
  }

  private closedError(status: string): CheckoutSessionClosedError {
    return new CheckoutSessionClosedError({
      title: "Checkout session closed",
      status: 409,
      code: "ConfirmCheckoutSession.SessionClosed",
      detail: `Kaiten: this checkout session is ${status}; start a new one.`,
      errors: [{ location: "session", message: "the session is closed", value: { status } }],
    });
  }
}
