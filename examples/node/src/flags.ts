// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { OFREPProvider } from "@openfeature/ofrep-provider";
import { OpenFeature } from "@openfeature/server-sdk";

/**
 * Registers Kaiten as this process's OpenFeature provider. Call it once, at startup.
 *
 * Kaiten implements OFREP, so OpenFeature's generic OFREP provider evaluates its flags.
 * `apiUrl` keeps its `/api`: the provider appends `/ofrep/v1/...` to it.
 */
export async function configureFlags(
  apiUrl: string,
  token: string | (() => string | Promise<string>),
  fetchImpl?: typeof fetch,
): Promise<void> {
  await OpenFeature.setProviderAndWait(
    "kaiten",
    new OFREPProvider({
      baseUrl: apiUrl,
      headersFactory: async () => [
        ["Authorization", `Bearer ${typeof token === "function" ? await token() : token}`],
      ],
      ...(fetchImpl ? { fetchImplementation: fetchImpl } : {}),
    }),
  );
}

/** One flag, for one user. On the server, each call is one remote evaluation. */
export async function isEnabled(
  flagKey: string,
  targetingKey: string,
  instanceSlug?: string,
): Promise<boolean> {
  const details = await OpenFeature.getClient("kaiten").getBooleanDetails(flagKey, false, {
    targetingKey,
    ...(instanceSlug ? { kaiten: { instanceSlug } } : {}),
  });
  // OpenFeature returns a default on provider errors. Never invert that fallback
  // or disclose transport/authentication details in a browser response.
  return !details.errorCode && details.value;
}
