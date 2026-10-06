// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The client's plumbing: the generated OpenAPI client, the transport, runtime
// primitives and config types. Re-exported by ../index.ts, the full generated
// surface under the `KaitenApi` namespace.

export * from "./generated/index.ts";
export { client } from "./generated/client.gen.ts";
export type { CreateClientConfig } from "./generated/client.gen.ts";

export {
  InvalidTransactionIdError,
  KaitenError,
  KaitenNetworkError,
  TransactionIdReusedError,
} from "./runtime/errors.ts";
export type {
  KaitenApiError,
  KaitenThrownError,
  TransactionIdReusedOriginal,
} from "./runtime/errors.ts";
export { assertPublishableKey, isPublishableKey } from "./runtime/keys.ts";
export { retry } from "./runtime/retry.ts";
export type { RetryOptions } from "./runtime/retry.ts";

export type {
  AuthenticatedKaitenProviderConfig,
  KaitenAuthErrorInfo,
  KaitenAuthScheme,
  KaitenClientConfig,
  KaitenFetch,
  KaitenPollingConfig,
  KaitenProviderConfig,
  KaitenTokenProvider,
  PublicKaitenProviderConfig,
} from "./config.ts";

export { KaitenTransport } from "./transport.ts";
