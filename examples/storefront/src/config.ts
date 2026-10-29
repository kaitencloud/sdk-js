// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the page needs to reach Kaiten, which its own backend tells it. Nothing in it is secret:
// the API's address and a publishable key, which reads the catalogue and nothing else.

import type { SignUpFields } from "./sign-up-fields.ts";

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
 * Who the visitor is to the storefront's backend. With `fixed` accounts the storefront has one
 * customer and signs every visitor in as it. With `sign-up` a visitor is a stranger until they make an
 * account, which the backend remembers in a cookie the page cannot read.
 */
export interface AccountState {
  accounts: "fixed" | "sign-up";
  signedIn: boolean;
}

export async function loadAccount(): Promise<AccountState> {
  const response = await fetch("/storefront-api/account", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`The storefront's backend answered ${response.status}.`);
  return (await response.json()) as AccountState;
}

/** The backend no longer knows who this is: the account was forgotten, or Kaiten deleted it. */
export class SignedOutError extends Error {
  constructor() {
    super("The account is gone: sign up again.");
    this.name = "SignedOutError";
  }
}

/**
 * A customer session for the signed-in customer, from the storefront's backend, which mints it
 * with a token the page never sees. The client calls it for its first request, and again before
 * the session ends or after the API refuses it. `onSignedOut` hears of a visitor who has no account,
 * or whose account Kaiten forgot, so that the page can show them as the visitor they now are.
 */
export async function fetchCustomerSession(
  onSignedOut?: () => void,
): Promise<{ token: string; expiresAt: string }> {
  const response = await fetch("/storefront-api/session", {
    method: "POST",
    credentials: "same-origin",
  });
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === "signed_out") {
      onSignedOut?.();
      throw new SignedOutError();
    }
  }
  if (!response.ok) {
    throw new Error(`The storefront could not get a customer session (${response.status}).`);
  }
  return (await response.json()) as { token: string; expiresAt: string };
}

/** What the backend answered to a sign-up that did not make an account. */
export type SignUpRefusal =
  | { kind: "invalid"; fields: SignUpFields }
  /** Kaiten does not accept the address. */
  | { kind: "invalid_email" }
  /** The catalogue has no free plan to start a new account on: a developer's problem, as is a missing scope. */
  | { kind: "free_plan_required" }
  /** The server's token lacks a scope: a developer's problem. The backend names it only to a developer (`vp dev`, the stand-in). */
  | { kind: "missing_scope"; scope: string }
  /** The Kaiten organization has no room for another customer or instance. */
  | { kind: "limit_reached" }
  /** Kaiten asks to wait: `retryAfter` seconds. */
  | { kind: "rate_limited" | "unavailable"; retryAfter: number }
  /** Anything else, and a backend that could not be reached. */
  | { kind: "failed" };

export type SignUpOutcome = { ok: true } | { ok: false; refusal: SignUpRefusal };

/**
 * Asks the backend to make the visitor an account. What it starts on is the backend's to decide: the
 * plan the visitor came to buy is not part of the request.
 */
export async function signUp(input: { name: string; email: string }): Promise<SignUpOutcome> {
  let response: Response;
  try {
    response = await fetch("/storefront-api/signup", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, refusal: { kind: "failed" } };
  }
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    fields?: SignUpFields;
    scope?: string;
  };
  // Signed in already, from another tab: the account is there, which is all the visitor wanted.
  if (response.ok || body.error === "already_signed_in") return { ok: true };

  const retryAfter = Number(response.headers.get("Retry-After")) || 1;
  switch (body.error) {
    case "invalid":
      return { ok: false, refusal: { kind: "invalid", fields: body.fields ?? {} } };
    case "invalid_email":
    case "free_plan_required":
    case "limit_reached":
      return { ok: false, refusal: { kind: body.error } };
    case "missing_scope":
      return { ok: false, refusal: { kind: "missing_scope", scope: body.scope ?? "a scope" } };
    case "rate_limited":
    case "unavailable":
      return { ok: false, refusal: { kind: body.error, retryAfter } };
    default:
      return { ok: false, refusal: { kind: "failed" } };
  }
}

/** Forgets the visitor's account: the backend revokes what it minted for it and clears the cookie. */
export async function signOut(): Promise<void> {
  const response = await fetch("/storefront-api/signout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`The storefront could not sign you out (${response.status}).`);
}
