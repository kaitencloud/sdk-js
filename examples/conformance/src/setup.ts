// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The one step of the journey that no SDK can take: the customer, on the payment
// provider's hosted page, saving a card. A person does it with a browser; the suite
// has to do it with a call.

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { Configuration } from "./configuration.ts";

/** The hosted page a checkout sent the customer to. */
export interface HostedSetup {
  setupUrl: string;
  setupSessionId: string;
}

/** Saves a card on the hosted page, and returns once the provider has it. */
export type CompleteSetup = (page: HostedSetup) => Promise<void>;

type Fetch = typeof globalThis.fetch;

/** What Stripe's test mode takes for a card that always works. */
const TEST_PAYMENT_METHOD = "pm_card_visa";

/**
 * Completes the page through the Stripe API, in test mode: the setup session is a
 * Stripe Checkout session, whose SetupIntent is confirmed with a test card, and which
 * must then read as complete. Whether Stripe lets that happen from outside the hosted
 * page has not been proven against a real account; if it does not, this fails
 * saying so, and a module of the person's own takes its place. The key
 * is the one of the Stripe account Kaiten is connected to (a restricted key that
 * reads Checkout sessions and writes SetupIntents is enough), and `Configuration`
 * only lets a test-mode one through.
 */
export function completeThroughStripe(
  { secretKey, apiUrl }: { secretKey: string; apiUrl: string },
  fetchImpl: Fetch = (...args) => fetch(...args),
): CompleteSetup {
  const call = async (path: string, init: RequestInit = {}): Promise<Record<string, unknown>> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${secretKey}`);
    const response = await fetchImpl(`${apiUrl}${path}`, { ...init, headers });
    const text = await response.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      // A body that is not JSON is reported by its status below.
    }
    if (!response.ok) {
      const error = (body.error ?? {}) as { message?: string };
      throw new Error(
        `Stripe answered ${response.status} to ${init.method ?? "GET"} ${path.split("?")[0]}: ${error.message ?? "no message"}`,
      );
    }
    return body;
  };

  return async ({ setupSessionId }) => {
    const session = await call(
      `/v1/checkout/sessions/${encodeURIComponent(setupSessionId)}?expand[]=setup_intent`,
    );
    const intent = session.setup_intent as { id?: string } | string | null | undefined;
    const intentId = typeof intent === "object" && intent !== null ? intent.id : undefined;
    if (!intentId) {
      throw new Error(
        "The setup session has no SetupIntent to confirm yet. Complete the page another way: " +
          "set KAITEN_CONFORMANCE_SETUP_MODULE to a module that does.",
      );
    }
    const confirmed = await call(`/v1/setup_intents/${encodeURIComponent(intentId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ payment_method: TEST_PAYMENT_METHOD }),
    });
    if (confirmed.status !== "succeeded") {
      throw new Error(`The SetupIntent is ${String(confirmed.status)}, not succeeded.`);
    }
    // Kaiten reads a setup as complete only when the Checkout session itself is, not
    // when its SetupIntent is: confirming the intent from outside the hosted page may
    // leave the session open. Better to say so here than to fail two steps later.
    const reread = await call(`/v1/checkout/sessions/${encodeURIComponent(setupSessionId)}`);
    if (reread.status !== "complete") {
      throw new Error(
        `The SetupIntent succeeded, but the Checkout session is ${String(reread.status)}, not complete, ` +
          "and Kaiten takes a setup as done only when the session is. Complete the page another way: " +
          "set KAITEN_CONFORMANCE_SETUP_MODULE to a module that does.",
      );
    }
  };
}

/**
 * The module a person wrote to complete the page: its default export is a
 * `CompleteSetup`. It may drive a browser, click through a fake provider's page, or
 * call whatever the stack under test offers.
 */
async function completeThroughModule(path: string): Promise<CompleteSetup> {
  const loaded = (await import(pathToFileURL(resolve(path)).href)) as { default?: unknown };
  if (typeof loaded.default !== "function") {
    throw new Error(
      `${path} must export a function as its default export: (page) => Promise<void>.`,
    );
  }
  return loaded.default as CompleteSetup;
}

/** The way to complete the hosted page that the configuration chose. */
export async function completerFor(setup: Configuration["setup"]): Promise<CompleteSetup> {
  return setup.kind === "stripe" ? completeThroughStripe(setup) : completeThroughModule(setup.path);
}
