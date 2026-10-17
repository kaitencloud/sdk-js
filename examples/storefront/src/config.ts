// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the page needs to reach Kaiten, which its own backend tells it. Nothing in it is secret:
// the API's address and a publishable key, which reads the catalogue and nothing else.

export interface StorefrontConfig {
  /** `double` while the backend plays Kaiten itself, `live` against a Kaiten. */
  mode: "double" | "live";
  apiUrl: string;
  publishableKey: string;
}

export async function loadConfig(): Promise<StorefrontConfig> {
  const response = await fetch("/storefront-api/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The storefront's backend answered ${response.status}.`);
  return (await response.json()) as StorefrontConfig;
}

/**
 * A customer session for the signed-in customer, from the storefront's backend, which mints it
 * with a token the page never sees. The client calls it for its first request, and again before
 * the session ends or after the API refuses it.
 */
export async function fetchCustomerSession(): Promise<{ token: string; expiresAt: string }> {
  const response = await fetch("/storefront-api/session", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`The storefront could not get a customer session (${response.status}).`);
  }
  return (await response.json()) as { token: string; expiresAt: string };
}
