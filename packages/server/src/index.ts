// @kaitencloud/server — Kaiten server SDK for external Node/TS backends.
//
// Full typed contract surface (Bearer auth), grouped by resource. The resource
// classes (`Customers`, `Instances`, …) are generated from the same OpenAPI
// snapshot as @kaitencloud/client, so coverage stays 100% of the contract
// automatically.
//
// Usage:
//   import { createKaitenClient, Customers } from "@kaitencloud/server";
//   const client = createKaitenClient({
//     baseUrl: process.env.KAITEN_API_URL!,
//     token: process.env.KAITEN_API_TOKEN!,
//   });
//   const customers = await Customers.listCustomers({ client });

import { createClient, createConfig } from "./generated/client/index.ts";
import type { Client } from "./generated/client/index.ts";
import type { ClientOptions } from "./generated/types.gen.ts";
import { toKaitenError } from "./errors.ts";

/**
 * Puts a base URL in the shape the contract is served under.
 *
 * The OpenAPI document mounts every operation below `/api` (`servers: - url:
 * /api`), and the operation paths are emitted bare (`/customers`), so a base URL
 * without that prefix 404s on every call. This follows the convention the
 * platform's own usage reporter already uses: require an absolute URL, drop a
 * trailing slash, append `/api` when it is not already there.
 *
 * Appending rather than rejecting accepts a bare origin as it is, and leaves a
 * gateway that already terminates on `/api` untouched.
 */
function normalizeBaseUrl(raw: string): ClientOptions["baseUrl"] {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new TypeError(
      `Kaiten baseUrl must be an absolute URL (received ${JSON.stringify(raw)}).`,
    );
  }

  if (!parsed.protocol || !parsed.host) {
    throw new TypeError(
      `Kaiten baseUrl must be an absolute URL (received ${JSON.stringify(raw)}).`,
    );
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = path.endsWith("/api") ? path : `${path}/api`;

  // `toString()` re-appends nothing beyond the normalized path; search/hash on a
  // base URL would be dropped by the request builder anyway.
  return `${parsed.origin}${parsed.pathname}` as ClientOptions["baseUrl"];
}

export interface KaitenServerConfig {
  /** Secret API token sent as a Bearer credential. Never use a publishable key here. */
  token: string | (() => string | Promise<string>);
  /**
   * URL of your Kaiten API. Required: there is no default. The `/api` prefix the
   * contract is served under is appended automatically when absent.
   */
  baseUrl: string;
  /** Custom fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Create a Bearer-authenticated client to pass to the generated resource
 * classes via their `{ client }` option. Each call to the factory yields an
 * independent client, so a single process can talk to the API with several
 * tokens.
 *
 * Failed calls **throw**. The generated resource methods are typed
 * `ThrowOnError extends boolean = false`, which would otherwise resolve
 * `{ data: undefined, error }` on every failure — so a caller reading `data`
 * sees a successful-looking `undefined`, and the 409 that
 * `Instances.reportEntitlementUsageMetric` answers with when an entitlement
 * threshold is reached reads as success. Errors are normalized to
 * {@link KaitenError} / {@link KaitenNetworkError}; use {@link isThresholdExceeded}
 * to detect the threshold case.
 */
export function createKaitenClient(config: KaitenServerConfig): Client {
  if (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "") {
    throw new TypeError("Kaiten baseUrl is required: the URL of your Kaiten API.");
  }

  const client = createClient(
    createConfig<ClientOptions>({
      baseUrl: normalizeBaseUrl(config.baseUrl),
      throwOnError: true,
      ...(config.fetch ? { fetch: config.fetch } : {}),
    }),
  );

  client.interceptors.request.use(async (request) => {
    const token = typeof config.token === "function" ? await config.token() : config.token;
    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return new Request(request, { headers });
  });

  // The generated transport rejects with the *parsed response body*, which has
  // no stack and is not an Error. Normalize before it reaches the caller.
  client.interceptors.error.use((error, response) => toKaitenError(error, response));

  return client;
}

export type { Client } from "./generated/client/index.ts";
export {
  KaitenError,
  KaitenNetworkError,
  isThresholdExceeded,
  toKaitenError,
  type KaitenApiError,
  type KaitenThrownError,
} from "./errors.ts";
export {
  verifyKaitenWebhook,
  isKaitenWebhookOfType,
  isWebhookVerificationError,
  KaitenWebhookVerificationError,
  type KaitenWebhookEvent,
  type KaitenWebhookType,
  type VerifyWebhookInput,
} from "./webhooks.ts";
export * from "./generated/index.ts";
