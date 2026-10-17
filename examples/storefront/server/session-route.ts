// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// `POST /storefront-api/session`: what the storefront's backend does so that its page can
// act for one customer. It mints a customer session (`kst_`) with the server token and hands
// the page the session and when it ends, and nothing else: the token stays here, and the
// page never holds a credential that reaches beyond one customer.
//
// This is the route to put behind your own authentication. It signs in a fixed customer,
// because the storefront has no accounts; a real one reads the signed-in user, finds
// their customer and instance, and mints for those.

import {
  createKaitenClient,
  CustomerSessions,
  isRateLimited,
  KaitenError,
} from "@kaitencloud/server";

import type { Route } from "./http.ts";

type Client = ReturnType<typeof createKaitenClient>;

export interface SessionRouteOptions {
  /** A client that carries a `ksh_` token with `write:customer_sessions`. */
  client: Client;
  /** The customer the page acts for. */
  customerSlug: string;
  /** The instance a checkout subscribes; a session without one only reads the customer. */
  instanceSlug: string;
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

export function sessionRoute(options: SessionRouteOptions): Route {
  const { client, customerSlug, instanceSlug, ttlSeconds = 1800 } = options;

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

    try {
      const { data: session } = await CustomerSessions.createCustomerSession({
        client,
        throwOnError: true,
        body: { customerSlug, instanceSlug, ttlSeconds },
      });
      // `session.id` is what revokes it, once the customer signs out: this storefront has no sign-out.
      return json(200, { token: session.token, expiresAt: session.expiresAt });
    } catch (error) {
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
          `[storefront] Kaiten refused a customer session: ${error.status} ${error.code}`,
        );
      } else {
        console.error("[storefront] Kaiten could not be reached to mint a customer session");
      }
      return json(502, { error: "session_unavailable" });
    }
  };
}
