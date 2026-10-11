// The client of the customer-session routes, `/public/session/*`: what a
// browser does for one signed-in customer, with a `kst_` session the vendor's
// backend mints. A class of its own rather than more methods on `KaitenClient`:
// it holds a different credential, which must never reach another route, and a
// host that does not offer a portal or a checkout does not ship its code.

import type { KaitenCustomerSession, KaitenSessionClientConfig } from "../core/config.ts";
import {
  apiErrorOf,
  DEFAULT_TIMEOUT_MS,
  resolveApiBaseUrl,
  resolveFetchImplementation,
  retryable,
} from "../core/http.ts";
import { KaitenError, KaitenNetworkError } from "../core/runtime/errors.ts";
import { retry } from "../core/runtime/retry.ts";
import { mapAddon } from "./billing.ts";
import {
  mapCheckout,
  mapInvoicePage,
  mapPortal,
  mapSubscription,
  mapVoucherValidation,
} from "./session-mapping.ts";
import type {
  PageSessionInvoice,
  SessionPortal as WirePortal,
  SessionSubscription as WireSubscription,
} from "../core/index.ts";
import type {
  CheckoutInput,
  CheckoutResult,
  KaitenPage,
  KaitenPortal,
  PaymentMethodSummary,
  PortalSubscription,
  SessionInvoice,
  VoucherValidation,
} from "./session-types.ts";
import type { Addon } from "./types.ts";

/**
 * What a client does for one customer with a customer session (`kst_`): the
 * `/public/session/*` routes, for a customer portal and a checkout.
 *
 * `KaitenSessionClient` implements it. A separate interface from
 * `KaitenClientLike`, which hosts implement and which therefore cannot gain a
 * member in 1.x: a host's own client or double opts in by implementing this
 * one.
 */
export interface KaitenSessionClientLike {
  /** The customer's portal: subscription, effective entitlements, add-ons, payment method. */
  getPortal: () => Promise<KaitenPortal>;
  /** The customer's issued invoices, newest first. */
  listInvoices: (options?: {
    cursor?: string;
    limit?: number;
  }) => Promise<KaitenPage<SessionInvoice>>;
  /** Subscribes the session's instance to a public price; `dryRun` previews what is due. */
  checkout: (input: CheckoutInput) => Promise<CheckoutResult>;
  /** Cancels the subscription at the end of its current period. */
  cancelSubscription: (input?: { reason?: string }) => Promise<PortalSubscription>;
  /** Withdraws a cancellation scheduled for the end of the period. */
  reactivateSubscription: () => Promise<PortalSubscription>;
  /** A link to the payment provider's billing portal. */
  createPortalSession: (input: {
    returnUrl: string;
  }) => Promise<{ url: string; expiresAt: string }>;
  /**
   * A hosted page where the customer adds or replaces a payment method.
   * `currencyCode` is required when the customer has no live subscription.
   */
  createPaymentMethodSession: (input: {
    returnUrl: string;
    currencyCode?: string;
  }) => Promise<{ url: string; sessionId: string; expiresAt: string }>;
  /** Records the payment method of a completed `createPaymentMethodSession`. */
  completePaymentMethodSession: (
    sessionId: string,
  ) => Promise<{ paymentMethod: PaymentMethodSummary }>;
  /** Checks a voucher code. It is redeemed by the checkout that carries it. */
  validateVoucher: (input: { code: string; licensePriceId?: string }) => Promise<VoucherValidation>;
  /** Sets how many units of an add-on the instance holds; `0` detaches it. */
  setAddonQuantity: (addonSlug: string, quantity: number) => Promise<Addon>;
}

/** How long before a customer session expires the client renews it. */
const RENEWAL_MARGIN_MS = 60_000;

const invalidSession = (detail: string) =>
  new KaitenError({ title: "Invalid customer session", status: 0, detail });

/**
 * The customer-session client.
 *
 * ```ts
 * const session = new KaitenSessionClient({
 *   apiUrl: "https://kaiten.example.com/api",
 *   // Your endpoint, which mints the session with @kaitencloud/server.
 *   getCustomerSession: () => fetch("/billing/session", { method: "POST" }).then((r) => r.json()),
 * });
 * const portal = await session.getPortal();
 * ```
 *
 * The session goes in `Authorization: Bearer kst_…`, to `/public/session/*` only,
 * with no cookie. It is renewed 60 seconds before it expires, by one call to
 * `getCustomerSession` however many requests wait on it; when the API refuses
 * it anyway (401), it is renewed once and the request sent once more, and a
 * second refusal reaches `onAuthError`. A read is replayed after a network
 * failure or a 5xx; a write never is.
 */
export class KaitenSessionClient implements KaitenSessionClientLike {
  private readonly config: KaitenSessionClientConfig;
  private readonly baseUrl: string;
  private readonly fetchImpl: NonNullable<KaitenSessionClientConfig["fetch"]>;
  private session?: { token: string; expiresAt: number };
  private renewal?: Promise<string>;

  constructor(config: KaitenSessionClientConfig) {
    if (typeof config.getCustomerSession !== "function") {
      throw new TypeError(
        "KaitenSessionClient needs getCustomerSession, which returns a session your backend mints.",
      );
    }
    this.config = config;
    this.baseUrl = resolveApiBaseUrl(config.apiUrl);
    this.fetchImpl = resolveFetchImplementation(config.fetch);
  }

  async getPortal(): Promise<KaitenPortal> {
    return mapPortal(await this.call<WirePortal>("GET", "portal", "getPortal()"));
  }

  async listInvoices(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<KaitenPage<SessionInvoice>> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", `${options.limit}`);
    const search = `${query}` ? `?${query}` : "";
    return mapInvoicePage(
      await this.call<PageSessionInvoice>("GET", `invoices${search}`, "listInvoices()"),
    );
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    return mapCheckout(await this.call("POST", "checkout", "checkout()", input));
  }

  async cancelSubscription(input: { reason?: string } = {}): Promise<PortalSubscription> {
    return mapSubscription(
      await this.call<WireSubscription>("POST", "billing/cancel", "cancelSubscription()", input),
    );
  }

  async reactivateSubscription(): Promise<PortalSubscription> {
    return mapSubscription(
      await this.call<WireSubscription>("POST", "billing/reactivate", "reactivateSubscription()"),
    );
  }

  createPortalSession(input: { returnUrl: string }): Promise<{ url: string; expiresAt: string }> {
    return this.call("POST", "billing/portal-session", "createPortalSession()", input);
  }

  createPaymentMethodSession(input: {
    returnUrl: string;
    currencyCode?: string;
  }): Promise<{ url: string; sessionId: string; expiresAt: string }> {
    const { currencyCode, returnUrl } = input;
    return this.call(
      "POST",
      "billing/payment-method-session",
      "createPaymentMethodSession()",
      currencyCode === undefined ? { returnUrl } : { returnUrl, currency: currencyCode },
    );
  }

  completePaymentMethodSession(
    sessionId: string,
  ): Promise<{ paymentMethod: PaymentMethodSummary }> {
    return this.call(
      "POST",
      `billing/payment-method-session/${encodeURIComponent(sessionId)}/complete`,
      `completePaymentMethodSession(${sessionId})`,
    );
  }

  async validateVoucher(input: {
    code: string;
    licensePriceId?: string;
  }): Promise<VoucherValidation> {
    return mapVoucherValidation(
      await this.call("POST", "vouchers/validate", "validateVoucher()", input),
    );
  }

  async setAddonQuantity(addonSlug: string, quantity: number): Promise<Addon> {
    return mapAddon(
      await this.call(
        "PUT",
        `addons/${encodeURIComponent(addonSlug)}`,
        `setAddonQuantity(${addonSlug})`,
        { quantity },
      ),
    );
  }

  /** One call to `/public/session/<route>`, with its retries and its renewal. */
  // oxlint-disable-next-line no-explicit-any -- the payload's shape is the route's.
  private call<T = any>(
    method: "GET" | "POST" | "PUT",
    route: string,
    label: string,
    body?: unknown,
  ): Promise<T> {
    return retry(
      async () => {
        let token = await this.sessionToken();
        try {
          return await this.send<T>(method, route, label, token, body);
        } catch (error) {
          if (!(error instanceof KaitenError) || error.status !== 401)
            throw this.refused(error, label);
          // The session was refused: renew it, once, and send the request again.
          token = await this.sessionToken(token);
          try {
            return await this.send<T>(method, route, label, token, body);
          } catch (again) {
            throw this.refused(again, label);
          }
        }
      },
      {
        retryImmediately: true,
        shouldRetry: (error, iteration) => retryable(method === "GET", error, iteration),
      },
    );
  }

  /** Tells the host the API refused its customer's credential, then hands the error back. */
  private refused(error: unknown, label: string): unknown {
    if (error instanceof KaitenError && (error.status === 401 || error.status === 403)) {
      this.config.onAuthError?.({ status: error.status, operation: label, error });
    }
    return error;
  }

  private async send<T>(
    method: string,
    route: string,
    label: string,
    token: string,
    body: unknown,
  ): Promise<T> {
    const headers = new Headers(this.config.defaultHeaders);
    headers.set("Authorization", `Bearer ${token}`);
    if (body !== undefined) headers.set("Content-Type", "application/json");

    let response: Response;
    try {
      response = await this.fetchImpl(
        new Request(`${this.baseUrl}/public/session/${route}`, {
          method,
          headers,
          // The public routes neither read nor set a cookie.
          credentials: "omit",
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        }),
      );
    } catch (error) {
      throw new KaitenNetworkError(`Network error during ${label}`, error);
    }

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // Not JSON: an error body from a proxy, kept as text.
    }
    if (!response.ok) throw apiErrorOf(parsed, response);
    return parsed as T;
  }

  /**
   * The session to send: the one held while it has more than a minute left and
   * is not the one the API just refused, a renewed one otherwise.
   */
  private async sessionToken(refused?: string): Promise<string> {
    const held = this.session;
    if (held && held.token !== refused && held.expiresAt - Date.now() > RENEWAL_MARGIN_MS) {
      return held.token;
    }
    this.renewal ??= this.renew().finally(() => {
      this.renewal = undefined;
    });
    return this.renewal;
  }

  private async renew(): Promise<string> {
    const session: KaitenCustomerSession | undefined = await this.config.getCustomerSession();
    const expiresAt = Date.parse(session?.expiresAt ?? "");
    if (typeof session?.token !== "string" || !session.token.startsWith("kst_")) {
      throw invalidSession("Kaiten: getCustomerSession must return a session token (kst_*).");
    }
    if (Number.isNaN(expiresAt)) {
      throw invalidSession("Kaiten: getCustomerSession must return expiresAt (RFC 3339).");
    }
    this.session = { token: session.token, expiresAt };
    return session.token;
  }
}
