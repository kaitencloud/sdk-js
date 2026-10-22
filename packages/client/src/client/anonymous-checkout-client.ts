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
import {
  assertPublishableKey,
  isBrowserRuntime,
  isCheckoutSessionToken,
} from "../core/runtime/keys.ts";
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
import { startCheckoutBody } from "./anonymous-checkout-input.ts";
import type {
  CheckoutConfirmation,
  CheckoutSession,
  CheckoutSessionOpened,
  CheckoutSessionPreview,
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
   * With `dryRun: true`, computes what a checkout would bill and answers a preview;
   * otherwise starts a checkout and answers the session opened, whose token the
   * client keeps. A Turnstile token is spent either way.
   *
   * ```ts
   * const started = await checkout.startCheckout({ turnstileToken, priceId, email, returnUrl });
   * await checkout.confirmCheckout(started.sessionId); // an opened session, no narrowing
   * ```
   *
   * An answer of the other kind than the one asked for rejects with a `KaitenError`.
   */
  startCheckout(input: StartCheckoutInput & { dryRun: true }): Promise<CheckoutSessionPreview>;
  startCheckout(input: StartCheckoutInput & { dryRun?: false }): Promise<CheckoutSessionOpened>;
  startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart>;
  /** Reads a session: its status, what is due and, once completed, the customer and instance created. */
  getCheckoutSession: (sessionId: string) => Promise<CheckoutSession>;
  /**
   * Confirms a session. It completes at once when nothing has to be paid, and
   * otherwise answers a hosted page that saves a payment method (call it again on
   * the way back) and then the payment's progress. It is safe to send again: it
   * answers the session's current state and never creates a second customer, instance
   * or charge, so after a timeout or a network failure confirm again, or read the
   * session, but never start another checkout.
   */
  confirmCheckout: (sessionId: string) => Promise<CheckoutConfirmation>;
  /**
   * Whether the client holds the token of that session, and so can read it, and
   * confirm it while it is open. A closed session's token is held for the 24 hours
   * the API still lets it read the outcome.
   */
  holdsCheckoutSession: (sessionId: string) => boolean;
  /** Drops the token of that session. */
  forgetCheckoutSession: (sessionId: string) => void;
}

/** The query member the hosted setup page brings the visitor back with. */
export const CHECKOUT_RETURN_PARAM = "kaiten_checkout_session";

/**
 * The checkout session a return URL names. The hosted setup page sends the visitor
 * back to the `returnUrl` of the start with `kaiten_checkout_session=<sessionId>`
 * added, and never the token. Returns that id and the URL without it; `null` when the
 * URL names no session.
 *
 * Reads `location.href` when it is given no URL. It changes nothing: once the
 * confirm or the read has succeeded, {@link clearCheckoutReturn} takes the session
 * out of the address bar, and not before, since a reload is how a failed attempt is
 * made again.
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

/**
 * Takes `kaiten_checkout_session` out of the page's address bar with
 * `history.replaceState`, keeping the history entry and its state, so that a reload
 * does not return to the checkout again. Call it **after** the confirm or the read
 * that followed the return has succeeded: a page that clears the address first and
 * then loses the network cannot find its session on reload. Returns whether the
 * address changed; `false` outside a browser, or when it names no session.
 */
export function clearCheckoutReturn(): boolean {
  const back = readCheckoutReturn();
  const history = globalThis.history;
  if (!back || typeof history?.replaceState !== "function") return false;
  try {
    history.replaceState(history.state, "", back.urlWithoutSession);
    return true;
  } catch {
    return false;
  }
}

/** The statuses after which a session never changes. */
const CLOSED: ReadonlySet<string> = new Set(["COMPLETED", "ABANDONED", "EXPIRED"]);

const STORAGE_KEY_PREFIX = "kaiten.checkout.";

/** How long the API lets the token read a session after it closed: 24 hours. */
const READ_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The timeout of a confirm when the host sets none. A confirm may open a payment
 * provider's objects and pay inline, so it gets longer than the 10 seconds of a read.
 */
const CONFIRM_TIMEOUT_MS = 30_000;

/**
 * `sessionStorage` in a browser that lets this page use it. Elsewhere memory alone:
 * a server runtime may have a `sessionStorage` of its own (an in-memory store that
 * Node offers, shared by every request of the process), which would keep every
 * visitor's token in one place.
 */
function defaultStorage(): KaitenCheckoutTokenStorage | undefined {
  if (!isBrowserRuntime()) return undefined;
  try {
    return globalThis.sessionStorage ?? undefined;
  } catch {
    // Blocked storage throws on access.
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const invalidSessionId = (method: string) =>
  new TypeError(`Kaiten: ${method} needs the sessionId startCheckout gave.`);

/** A token held for a session, and when the client saw the session close, if it did. */
interface Held {
  token: string;
  closedAt?: number;
}

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
 * **The token** is kept by the client as well as returned: in memory and in
 * `sessionStorage`, under the session's id, because the payment method setup is a
 * full-page redirect and the page that comes back must still be able to confirm. It
 * is never put in a URL or in `localStorage`. A session that closes keeps its token
 * for the 24 hours the API still answers a read with it, so that a reload shows the
 * outcome; it is dropped when the API refuses it or on `forgetCheckoutSession`.
 * {@link readCheckoutReturn} reads the session's id from the return URL.
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
  private readonly tokens = new Map<string, Held>();
  /** The last answer for each session seen closed: a closed session never changes. */
  private readonly closed = new Map<string, CheckoutSession>();

  constructor(config: KaitenAnonymousCheckoutClientConfig) {
    assertPublishableKey(config.publishableKey);
    this.config = config;
    this.baseUrl = resolveApiBaseUrl(config.apiUrl);
    this.fetchImpl = resolveFetchImplementation(config.fetch);
    this.storage = config.storage === undefined ? defaultStorage() : (config.storage ?? undefined);
  }

  startCheckout(input: StartCheckoutInput & { dryRun: true }): Promise<CheckoutSessionPreview>;
  startCheckout(input: StartCheckoutInput & { dryRun?: false }): Promise<CheckoutSessionOpened>;
  startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart>;
  async startCheckout(input: StartCheckoutInput): Promise<CheckoutSessionStart> {
    const body = startCheckoutBody(input);
    const dryRun = input.dryRun === true;
    const label = dryRun ? "startCheckout(dryRun)" : "startCheckout()";
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

    // Whatever the status says, a session the API opened is one the client holds.
    if (typeof raw.sessionId === "string" && isCheckoutSessionToken(raw.token)) {
      this.remember(raw.sessionId, { token: raw.token });
    } else if (raw.status === "open") {
      throw new KaitenError({
        title: "Malformed checkout session",
        status: 0,
        detail: "Kaiten: the API opened a checkout session without its id or its ksc_ token.",
      });
    }
    const started = mapCheckoutSessionStart(raw);
    if (started.status !== (dryRun ? "preview" : "open")) {
      throw new KaitenError({
        title: "Unexpected checkout start",
        status: 0,
        detail: `Kaiten: ${label} was answered with a ${started.status}.`,
      });
    }
    return started;
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession> {
    if (typeof sessionId !== "string" || sessionId === "")
      throw invalidSessionId("getCheckoutSession");
    const token = this.tokenOf(sessionId);
    const known = this.closed.get(sessionId);
    if (known) return structuredClone(known);

    const label = `getCheckoutSession(${sessionId})`;
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
    const token = this.tokenOf(sessionId);
    const known = this.closed.get(sessionId);
    if (known) throw this.closedError(known.status);

    const label = `confirmCheckout(${sessionId})`;
    const raw = await this.guarded(
      sendPublic<WireConfirmation>(
        this.fetchImpl,
        `${this.sessionUrl(sessionId)}/confirm`,
        {
          method: "POST",
          headers: this.bearer(token),
          timeoutMs: this.config.timeoutMs ?? CONFIRM_TIMEOUT_MS,
        },
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
    this.closed.delete(sessionId);
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
   * which nothing can renew, then hands the error back. Only a refused credential
   * is an auth error: a 401, or a 403 `WrongCredentialKind`. A 403 that says the
   * feature is off (`AnonymousCheckoutDisabled`) or the origin is not allowed is
   * the host's configuration, not a credential to renew, and keeps the token. A 409
   * `SessionClosed` keeps it too: the session is read once more to learn how it closed.
   */
  private async guarded<T>(call: Promise<T>, label: string, sessionId?: string): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (error instanceof KaitenError) {
        const credential =
          error.status === 401 ||
          (error.status === 403 && error.code === "Auth.WrongCredentialKind");
        if (credential) {
          if (sessionId !== undefined && error.status === 401)
            this.forgetCheckoutSession(sessionId);
          this.config.onAuthError?.({
            status: error.status as 401 | 403,
            operation: label,
            error,
          });
        }
      }
      throw error;
    }
  }

  private remember(sessionId: string, held: Held): void {
    this.tokens.set(sessionId, held);
    const credential: KaitenCheckoutCredential = { sessionId, ...held };
    try {
      this.storage?.setItem(`${STORAGE_KEY_PREFIX}${sessionId}`, JSON.stringify(credential));
    } catch {
      // Full or blocked storage: the token lives in memory, and a redirect loses it.
    }
  }

  /**
   * The token held for a session: from memory, else from the storage a redirect
   * left it in. A closed session's token is gone once its 24 hours of reads are.
   */
  private recall(sessionId: string): Held | undefined {
    let held = this.tokens.get(sessionId);
    if (!held) {
      try {
        const stored: unknown = JSON.parse(
          this.storage?.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`) ?? "null",
        );
        if (
          isRecord(stored) &&
          stored["sessionId"] === sessionId &&
          isCheckoutSessionToken(stored["token"])
        ) {
          held = {
            token: stored["token"],
            ...(typeof stored["closedAt"] === "number" ? { closedAt: stored["closedAt"] } : {}),
          };
          this.tokens.set(sessionId, held);
        }
      } catch {
        // Unreadable storage, or a value that is not ours: no token.
      }
    }
    if (held?.closedAt !== undefined && Date.now() - held.closedAt > READ_WINDOW_MS) {
      this.forgetCheckoutSession(sessionId);
      return undefined;
    }
    return held;
  }

  private tokenOf(sessionId: string): string {
    const held = this.recall(sessionId);
    if (!held) throw new CheckoutTokenMissingError(sessionId);
    return held.token;
  }

  /**
   * Remembers a session that closed, and when. Its token acts on nothing but a
   * read from then on, and the API keeps answering that read for 24 hours so that
   * a page learns the outcome; so the client keeps the token for as long, and a
   * reload after a completed payment still finds it.
   */
  private seen(session: CheckoutSession): CheckoutSession {
    if (CLOSED.has(session.status)) {
      this.closed.set(session.sessionId, structuredClone(session));
      const held = this.recall(session.sessionId);
      if (held && held.closedAt === undefined) {
        this.remember(session.sessionId, { token: held.token, closedAt: Date.now() });
      }
    }
    return session;
  }

  private closedError(status: string): CheckoutSessionClosedError {
    return new CheckoutSessionClosedError({
      title: "Checkout session closed",
      status: 409,
      code: "ConfirmCheckoutSession.SessionClosed",
      detail: `Kaiten: this checkout session is ${status}. Read it with getCheckoutSession to see the outcome.`,
      errors: [{ location: "session", message: "the session is closed", value: { status } }],
    });
  }
}
