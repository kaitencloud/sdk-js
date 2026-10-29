// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Which Kaiten the storefront talks to, and how its visitors get an account, read from the
// environment of its server: the shell's, and the `.env` files next to `vite.config.ts` (see
// `loadEnvironment`).
//
// With none of the variables below the storefront runs against a stand-in for Kaiten that lives in
// this process (`./double`), which is what `vp dev`, `vp preview` and the end-to-end tests do by
// default. With KAITEN_API_URL, KAITEN_API_TOKEN and KAITEN_PUBLISHABLE_KEY it runs against the
// Kaiten they name, and then:
//
// - with STOREFRONT_CUSTOMER_SLUG and STOREFRONT_INSTANCE_SLUG too, as that one customer;
// - without either, in sign-up mode: a visitor makes an account, which is a new customer and a new
//   instance in that Kaiten.
//
// With some of them it refuses to start and says which are missing: a shell that kept one variable
// from another project must not quietly give a different storefront. The two slugs go together.

import { loadEnv } from "vite-plus";

import { MIN_SECRET_LENGTH } from "./account-cookie.ts";

interface LiveBase {
  mode: "live";
  /** Your Kaiten API's URL, `/api` included. */
  apiUrl: string;
  /**
   * A `ksh_` token that holds `write:customer_sessions`, `read:customers`, `write:customers`,
   * `read:instances` and `write:instances`: the last four name the customer a visitor's anonymous
   * checkout made (the server reads it and its instance, then writes their names), and sign-up mode
   * writes both. It never leaves the server.
   */
  serverToken: string;
  /** A publishable key (`pk_`) whose allowed origins include the storefront's. */
  publishableKey: string;
  /** Signs the cookie that remembers a visitor's account (sign-up mode). Absent: one is made at each start. */
  cookieSecret?: string;
}

/** One customer signed in for every visitor: the storefront has no accounts. */
export interface FixedCustomerEnvironment extends LiveBase {
  /** The customer the storefront signs in as. */
  customerSlug: string;
  /** One of that customer's instances: the one a checkout subscribes. */
  instanceSlug: string;
}

/** Visitors sign up: each makes a customer and an instance of their own. */
export interface SignUpEnvironment extends LiveBase {
  customerSlug?: undefined;
  instanceSlug?: undefined;
}

export type LiveEnvironment = FixedCustomerEnvironment | SignUpEnvironment;

export interface DoubleEnvironment {
  mode: "double";
  /** See `LiveBase["cookieSecret"]`: the stand-in's sign-up mode signs its cookie with it too. */
  cookieSecret?: string;
}

export type Environment = LiveEnvironment | DoubleEnvironment;

/** The variables of a live storefront, by what they hold. */
export const LIVE_VARIABLES = {
  apiUrl: "KAITEN_API_URL",
  serverToken: "KAITEN_API_TOKEN",
  publishableKey: "KAITEN_PUBLISHABLE_KEY",
  customerSlug: "STOREFRONT_CUSTOMER_SLUG",
  instanceSlug: "STOREFRONT_INSTANCE_SLUG",
  cookieSecret: "STOREFRONT_COOKIE_SECRET",
} as const satisfies Record<Exclude<keyof FixedCustomerEnvironment, "mode">, string>;

type Variables = Record<string, string | undefined>;

/**
 * The variables of a live storefront as the server sees them, from the shell and from the
 * `.env` files of `envDir`, the way Vite reads them: `.env`, `.env.local`, `.env.[mode]` and
 * `.env.[mode].local`, the last one winning.
 *
 * A variable the shell holds wins over every file, and it wins empty: an empty variable is how
 * a test runner switches live mode off, and a developer's `.env` must not switch it back on.
 * That is `loadEnv`'s own rule for the process environment.
 *
 * Only these names are taken, and only on the server. They carry no `VITE_` prefix, so Vite
 * never puts them in `import.meta.env` or in the page, whatever the files hold.
 */
export function loadEnvironmentVariables(mode: string, envDir: string): Variables {
  const names = Object.values(LIVE_VARIABLES);
  const loaded = loadEnv(mode, envDir, names);
  return Object.fromEntries(names.map((name) => [name, loaded[name]]));
}

/** The environment of a storefront server started in `mode`, with `envDir` as its `.env` directory. */
export function loadEnvironment(mode: string, envDir: string): Environment {
  return readEnvironment(loadEnvironmentVariables(mode, envDir));
}

/** The three variables that name the Kaiten, and the two that name one customer of it, in order. */
const KAITEN = ["apiUrl", "serverToken", "publishableKey"] as const;
const CUSTOMER = ["customerSlug", "instanceSlug"] as const;

/**
 * The environment the storefront runs in. An empty variable is an unset one, which is
 * how a test runner switches the others off.
 */
export function readEnvironment(variables: Variables = process.env): Environment {
  const value = (member: keyof typeof LIVE_VARIABLES) =>
    variables[LIVE_VARIABLES[member]]?.trim() ?? "";
  const missing = (members: readonly (keyof typeof LIVE_VARIABLES)[]) =>
    members.filter((member) => value(member) === "");

  // Whenever it is set, it must be fit to sign with: a secret too short to be one is a mistake, and
  // is better found at start than in a cookie that anyone could forge. Its value is never repeated.
  const secret = value("cookieSecret");
  if (secret !== "" && secret.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${LIVE_VARIABLES.cookieSecret} must be at least ${MIN_SECRET_LENGTH} characters, or left out ` +
        `to sign the cookie with a key made at each start.`,
    );
  }
  const cookieSecret = secret === "" ? {} : { cookieSecret: secret };

  const kaiten = missing(KAITEN);
  const customer = missing(CUSTOMER);
  if (kaiten.length === KAITEN.length && customer.length === CUSTOMER.length) {
    return { mode: "double", ...cookieSecret };
  }

  // A pair with one half is a mistake in either direction, so the half that is left out is named
  // whatever else is missing; both halves left out is sign-up mode, not a mistake.
  const half = customer.length === 1 ? customer : [];
  const refused = [...kaiten, ...half].map((member) => LIVE_VARIABLES[member]);
  if (refused.length > 0) {
    throw new Error(
      `The storefront runs against a stand-in for Kaiten with none of ${[...KAITEN, ...CUSTOMER].map((member) => LIVE_VARIABLES[member]).join(", ")}, ` +
        `and against your Kaiten with ${LIVE_VARIABLES.apiUrl}, ${LIVE_VARIABLES.serverToken} and ${LIVE_VARIABLES.publishableKey} ` +
        `(visitors then sign up) or with all five (one customer is signed in), ` +
        `set in the shell or in a .env file next to vite.config.ts. ` +
        `${LIVE_VARIABLES.customerSlug} and ${LIVE_VARIABLES.instanceSlug} go together: both to sign in as one customer, ` +
        `neither to let visitors sign up. ` +
        `${LIVE_VARIABLES.serverToken} is needed even for a visitor who only buys with no account: ` +
        `the server holds it for the sign-up and customer-session routes. ` +
        `These are missing: ${refused.join(", ")}.`,
    );
  }

  const live = {
    mode: "live" as const,
    apiUrl: value("apiUrl"),
    serverToken: value("serverToken"),
    publishableKey: value("publishableKey"),
    ...cookieSecret,
  };
  return customer.length === 0
    ? { ...live, customerSlug: value("customerSlug"), instanceSlug: value("instanceSlug") }
    : live;
}

/** Whether visitors sign up, in an environment: a live one that names no customer, or the stand-in's default. */
export const signsUp = (environment: Environment): environment is SignUpEnvironment =>
  environment.mode === "live" && environment.customerSlug === undefined;

/** The lines the server prints at start, one per fact a developer needs. */
export function describeEnvironment(environment: Environment): string[] {
  if (environment.mode === "double") {
    return [
      "storefront: running against a stand-in for Kaiten (copy .env.example to .env and fill it, or set the same variables in your shell, to use yours)",
      "storefront: the stand-in lives in this process: it, and any account a visitor makes in it, are forgotten when the server restarts",
    ];
  }
  if (environment.customerSlug !== undefined) {
    return [
      `storefront: running against the Kaiten at ${environment.apiUrl}, as the customer ${environment.customerSlug}`,
    ];
  }
  return [
    `storefront: running against the Kaiten at ${environment.apiUrl}; visitors sign up (${LIVE_VARIABLES.serverToken} needs write:customers, write:instances and write:customer_sessions)`,
    ...(environment.cookieSecret === undefined
      ? [
          `storefront: accounts are kept in a cookie signed with a key made at start, and are forgotten when the server restarts: set ${LIVE_VARIABLES.cookieSecret} (${MIN_SECRET_LENGTH} characters or more) to keep them`,
        ]
      : []),
  ];
}
