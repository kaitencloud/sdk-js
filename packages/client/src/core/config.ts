// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

export type KaitenAuthScheme = "bearer" | "publishable" | "none";

export type KaitenFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Resolves the credential for the next request. Called per request, so a host
 * whose token rotates (a refreshed session, a short-lived mint) is always read
 * fresh rather than pinned to whatever was passed at construction.
 */
export type KaitenTokenProvider = () => string | Promise<string>;

export interface KaitenClientConfig {
  apiUrl: string;
  tokenProvider?: KaitenTokenProvider;
  /**
   * How the credential `tokenProvider` returns is sent. Required: there is no
   * default.
   *
   * - `"bearer"`: `Authorization: Bearer <token>`, for a `ksh_` token or a JWT the
   *   API's gateway verifies. Both carry rights over a whole organization: use
   *   them on a server. In a browser, the client refuses to send a secret.
   * - `"publishable"`: `X-Kaiten-Publishable-Key`, for a publishable key
   *   (`pk_`), which reads the public catalog and nothing else: `getCatalog()`
   *   calls `GET /public/catalog`, and every other read or write is refused
   *   before any request. A publishable key is meant for a browser.
   * - `"none"`: no credential, for an endpoint in front of Kaiten that
   *   authenticates the request itself.
   */
  authScheme: KaitenAuthScheme;
  defaultHeaders?: Record<string, string>;
  fetch?: KaitenFetch;
  /** Optional per-request timeout in milliseconds (AbortSignal.timeout). */
  timeoutMs?: number;
  /**
   * Called when the API rejects the credential (401/403).
   *
   * The request is NOT retried — the SDK cannot know how to obtain a new
   * credential. Use this to refresh the host session or send the user to sign
   * in; because `tokenProvider` is consulted per request, the next poll picks up
   * the new token with no further wiring.
   */
  onAuthError?: (error: KaitenAuthErrorInfo) => void;
  /**
   * Called when a composed read falls back from GraphQL to the REST fan-out.
   *
   * The fallback is deliberate and the SDK keeps working, so this is not an
   * error path — but it is never free, and it used to be invisible. Degrading
   * costs a request per license instead of one query (there is no bulk REST
   * endpoint), and it silently drops the presentation metadata that only the
   * GraphQL read path carries: icons, units, sale units, display order,
   * entitlement groups. A component that renders "8 $ per 1M tokens" against
   * GraphQL renders "8 $ per unit" against REST, with nothing to say why.
   *
   * Without this hook the two reasons to degrade are indistinguishable: an API
   * older than the schema (permanent, fix by upgrading) and an outage
   * (transient, fix by waiting). Log it, or alert on it.
   */
  onDegraded?: (info: KaitenDegradedInfo) => void;
}

/**
 * A customer session, as the vendor's backend mints it with
 * `CustomerSessions.createCustomerSession` of `@kaitencloud/server` and hands it
 * to the browser.
 */
export interface KaitenCustomerSession {
  /** The `kst_` session token. */
  token: string;
  /** When the session expires (RFC 3339). */
  expiresAt: string;
}

/**
 * Obtains a customer session from the host's own backend, which mints it. The
 * session client calls it for its first call, again 60 seconds before the
 * session expires, and once more when the API refuses the session (401).
 * Concurrent calls share one invocation.
 */
export type KaitenCustomerSessionProvider = () =>
  | KaitenCustomerSession
  | Promise<KaitenCustomerSession>;

export interface KaitenSessionClientConfig {
  /** Your Kaiten API's URL, `/api` included. */
  apiUrl: string;
  /** Returns the customer session to send. Called again before it expires. */
  getCustomerSession: KaitenCustomerSessionProvider;
  defaultHeaders?: Record<string, string>;
  fetch?: KaitenFetch;
  /** Optional per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Called when the API refuses a session the client has already renewed once
   * (401), or refuses the call itself (403). Use it to sign the customer in
   * again.
   */
  onAuthError?: (error: KaitenAuthErrorInfo) => void;
}

/**
 * The credential of one anonymous checkout: the `ksc_` token `startCheckout`
 * obtained for a session. It reads and confirms that session and nothing else.
 * The client keeps it, in memory and in the storage below; it is never in a URL.
 */
export interface KaitenCheckoutCredential {
  /** The checkout session the token was minted for. */
  sessionId: string;
  /** The `ksc_` token. */
  token: string;
  /**
   * When the client saw the session close (milliseconds since the epoch), absent while
   * it is open. The token is dropped 24 hours later, when the API stops answering it.
   */
  closedAt?: number;
}

/**
 * Where the client keeps the checkout session tokens it obtained, so that the
 * page that comes back from the payment method setup (a full-page redirect) can
 * still confirm the session. The shape of `Storage`, which `sessionStorage` is.
 * A host that passes its own keeps the tokens out of `localStorage` and out of any
 * place another origin or another tab can read.
 */
export interface KaitenCheckoutTokenStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface KaitenAnonymousCheckoutClientConfig {
  /** Your Kaiten API's URL, `/api` included. */
  apiUrl: string;
  /**
   * A publishable key (`pk_…`) that has anonymous checkout turned on. It is sent in
   * `X-Kaiten-Publishable-Key` to the route that starts a checkout and nowhere else.
   */
  publishableKey: string;
  defaultHeaders?: Record<string, string>;
  fetch?: KaitenFetch;
  /** Optional per-request timeout in milliseconds. */
  timeoutMs?: number;
  /**
   * Called when the API refuses the credential of a call: a 401, or a 403
   * `Auth.WrongCredentialKind`. A refused checkout session token is forgotten first;
   * there is nothing to renew it with. A 403 that says the feature is off
   * (`AnonymousCheckoutDisabled`) or the origin is not allowed is not a credential
   * problem and does not call it: it rejects the call with a `KaitenError`, as any
   * other refusal does.
   */
  onAuthError?: (error: KaitenAuthErrorInfo) => void;
  /**
   * Where the session tokens are kept across a page load. Defaults to
   * `sessionStorage` in a browser that lets the page use it, else to memory alone
   * (a server runtime's own `sessionStorage` is never used: it is shared by every
   * visitor); `null` keeps them in memory only, which a redirect to the setup page
   * loses.
   */
  storage?: KaitenCheckoutTokenStorage | null;
}

export interface KaitenAuthErrorInfo {
  status: 401 | 403;
  /** The operation that was rejected, e.g. `POST /graphql`. */
  operation: string;
  error: unknown;
}

export interface KaitenDegradedInfo {
  /** The composed read that degraded, e.g. `getLicensingSnapshot`. */
  operation: string;
  /**
   * The error that closed the GraphQL path — the reason this callback exists.
   * It was previously swallowed by a bare `catch`, which is what made a schema
   * mismatch indistinguishable from an outage.
   */
  error: unknown;
}

export interface KaitenPollingConfig {
  enabled?: boolean;
  interval?: number;
}

export interface PublicKaitenProviderConfig {
  mode: "public";
  publishableKey: string;
  apiUrl?: string;
  polling?: KaitenPollingConfig;
  /** See `KaitenClientConfig["onDegraded"]`. Public mode degrades on `getCatalog`. */
  onDegraded?: (info: KaitenDegradedInfo) => void;
}

export interface AuthenticatedKaitenProviderConfig {
  mode: "authenticated";
  /**
   * The credential, or a function returning it.
   *
   * Pass a function when the host resolves tokens asynchronously (Clerk's
   * `getToken()`, a refresh-backed session): it is called per request, so a
   * rotated token is picked up without remounting the provider. Passing an
   * inline arrow is safe — the provider reads the latest one through a ref
   * rather than rebuilding its client on every render.
   */
  accessToken: string | KaitenTokenProvider;
  customerId: string;
  instanceId?: string;
  apiUrl?: string;
  polling?: KaitenPollingConfig;
  /** See `KaitenClientConfig["onAuthError"]`. */
  onAuthError?: (error: KaitenAuthErrorInfo) => void;
  /** See `KaitenClientConfig["onDegraded"]`. Authenticated mode degrades on `getLicensingSnapshot`. */
  onDegraded?: (info: KaitenDegradedInfo) => void;
}

export type KaitenProviderConfig = PublicKaitenProviderConfig | AuthenticatedKaitenProviderConfig;
