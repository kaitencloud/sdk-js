// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// `POST /storefront-api/session`: what the storefront's backend does so that its page can
// act for one customer. It mints a customer session (`kst_`) with the server token and hands
// the page the session and when it ends, and nothing else: the token stays here, and the
// page never holds a credential that reaches beyond one customer.
//
// This is the route to put behind your own authentication. It mints for a fixed customer, or, in
// sign-up mode, for the account the visitor's cookie names (`accounts`); a real storefront reads
// its signed-in user, finds their customer and instance, and mints for those.

import {
  createKaitenClient,
  CustomerSessions,
  isRateLimited,
  KaitenError,
} from "@kaitencloud/server";

import type { Account } from "./account-cookie.ts";
import type { Route } from "./http.ts";

type Client = ReturnType<typeof createKaitenClient>;

/** Whose session a sign-up storefront mints: the account of the visitor's cookie. */
export interface SessionAccounts {
  /** The account the request's cookie holds, or `null` for a visitor who has none. */
  of: (request: Request) => Account | null;
  /** The `Set-Cookie` that forgets the account, for when Kaiten no longer knows it. */
  forget: (request: Request) => string;
  /** Called with each session minted, so that a sign-out can revoke it. */
  minted?: (account: Account, sessionId: string) => void;
}

export interface SessionRouteOptions {
  /** A client that carries a `ksh_` token with `write:customer_sessions`. */
  client: Client;
  /** The customer the page acts for. Not needed when `accounts` is. */
  customerSlug?: string;
  /** The instance a checkout subscribes; a session without one only reads the customer. */
  instanceSlug?: string;
  /** In sign-up mode, the account each request mints for, in place of the fixed customer. */
  accounts?: SessionAccounts;
  /** Whether sign-up mode is on, asked at each request. Default: it is, when `accounts` is given. */
  signUp?: () => boolean;
  /** How long the session lives, 300 to 3600 seconds. Default 1800. */
  ttlSeconds?: number;
}

/** The path the page calls. */
export const SESSION_PATH = "/storefront-api/session";

const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...headers },
  });

/** Kaiten does not know the customer or the instance an account names: it was deleted, or the stand-in started over. */
const isUnknownAccount = (error: unknown) =>
  error instanceof KaitenError &&
  error.status === 404 &&
  (error.code === "CreateCustomerSession.CustomerNotFound" ||
    error.code === "CreateCustomerSession.InstanceNotFound");

export function sessionRoute(options: SessionRouteOptions): Route {
  const { client, accounts, ttlSeconds = 1800 } = options;
  const signUp = options.signUp ?? (() => accounts !== undefined);
  if (accounts === undefined && (!options.customerSlug || !options.instanceSlug)) {
    throw new TypeError("sessionRoute needs a fixed customer and instance, or accounts.");
  }

  return async (request) => {
    if (new URL(request.url).pathname !== SESSION_PATH) return undefined;

    if (request.method !== "POST")
      return json(405, { error: "method_not_allowed" }, { Allow: "POST" });

    // A page of another origin must not make this server mint sessions: a browser says where a
    // request comes from, and a route that mints is not for every page on the internet.
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== new URL(request.url).origin) {
      return json(403, { error: "cross_origin" });
    }

    // In sign-up mode the account is the visitor's own, and a visitor with none gets nothing minted.
    const accountMode = accounts !== undefined && signUp();
    let account: Account;
    if (accountMode) {
      const known = accounts.of(request);
      if (known === null) return json(401, { error: "signed_out" });
      account = known;
    } else {
      account = { customerSlug: options.customerSlug!, instanceSlug: options.instanceSlug! };
    }

    try {
      const { data: session } = await CustomerSessions.createCustomerSession({
        client,
        throwOnError: true,
        body: { ...account, ttlSeconds },
      });
      // `session.id` is what revokes it, once the customer signs out.
      if (accountMode) accounts.minted?.(account, session.id);
      return json(200, { token: session.token, expiresAt: session.expiresAt });
    } catch (error) {
      // A cookie that is valid for an account Kaiten has forgotten is a visitor again.
      if (accountMode && isUnknownAccount(error)) {
        return json(401, { error: "signed_out" }, { "Set-Cookie": accounts.forget(request) });
      }
      // Kaiten's answer is not the page's to read: the page learns that minting failed, and when to try again.
      if (isRateLimited(error)) {
        return json(
          429,
          { error: "rate_limited" },
          { "Retry-After": String(error.retryAfterSeconds ?? 1) },
        );
      }
      if (error instanceof KaitenError) {
        console.error(
          error.status === 403 && error.code === "Auth.MissingScope"
            ? "[storefront] Kaiten refused to mint a customer session: KAITEN_API_TOKEN does not hold write:customer_sessions."
            : `[storefront] Kaiten refused a customer session: ${error.status} ${error.code}`,
        );
      } else {
        console.error("[storefront] Kaiten could not be reached to mint a customer session");
      }
      return json(502, { error: "session_unavailable" });
    }
  };
}
