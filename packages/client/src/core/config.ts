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
   * - `"publishable"`: `X-Kaiten-Publishable-Key`, for the publishable keys
   *   (`pk_`) to come. No endpoint accepts them in this release.
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
