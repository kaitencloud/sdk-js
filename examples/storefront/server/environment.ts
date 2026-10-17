// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Which Kaiten the storefront talks to, read from the environment of its server.
//
// With none of the variables below the storefront runs against a stand-in for Kaiten
// that lives in this process (`./double`), which is what `vp dev`, `vp preview` and the
// end-to-end tests do by default. With all of them it runs against the Kaiten they name.
// With some of them it refuses to start and says which are missing: a shell that kept
// one variable from another project must not quietly give a different storefront.

export interface LiveEnvironment {
  mode: "live";
  /** Your Kaiten API's URL, `/api` included. */
  apiUrl: string;
  /** A `ksh_` token that holds `write:customer_sessions`. It never leaves the server. */
  serverToken: string;
  /** A publishable key (`pk_`) whose allowed origins include the storefront's. */
  publishableKey: string;
  /** The customer the storefront signs in as. */
  customerSlug: string;
  /** One of that customer's instances: the one a checkout subscribes. */
  instanceSlug: string;
}

export interface DoubleEnvironment {
  mode: "double";
}

export type Environment = LiveEnvironment | DoubleEnvironment;

/** The variables of a live storefront, by what they hold. */
export const LIVE_VARIABLES = {
  apiUrl: "KAITEN_API_URL",
  serverToken: "KAITEN_API_TOKEN",
  publishableKey: "KAITEN_PUBLISHABLE_KEY",
  customerSlug: "STOREFRONT_CUSTOMER_SLUG",
  instanceSlug: "STOREFRONT_INSTANCE_SLUG",
} as const satisfies Record<Exclude<keyof LiveEnvironment, "mode">, string>;

type Variables = Record<string, string | undefined>;

/**
 * The environment the storefront runs in. An empty variable is an unset one, which is
 * how a test runner switches the others off.
 */
export function readEnvironment(variables: Variables = process.env): Environment {
  const entries = Object.entries(LIVE_VARIABLES).map(
    ([member, name]) => [member, name, variables[name]?.trim() ?? ""] as const,
  );
  const missing = entries.filter(([, , value]) => value === "").map(([, name]) => name);

  if (missing.length === entries.length) return { mode: "double" };
  if (missing.length > 0) {
    throw new Error(
      `The storefront runs against a stand-in for Kaiten with none of ${Object.values(LIVE_VARIABLES).join(", ")}, ` +
        `and against your Kaiten with all of them. These are missing: ${missing.join(", ")}.`,
    );
  }

  const live = Object.fromEntries(entries.map(([member, , value]) => [member, value]));
  return { mode: "live", ...live } as unknown as LiveEnvironment;
}
