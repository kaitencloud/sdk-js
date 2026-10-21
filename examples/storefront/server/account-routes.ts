// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The storefront's accounts, in sign-up mode: a visitor who is not a customer yet makes an account on
// the site, and the site's backend makes it in Kaiten.
//
// Kaiten V1 has no anonymous checkout (spec D-49): a checkout is a customer's, and a customer is
// something the vendor creates. So when the visitor signs up, this backend
//
//   1. creates the Kaiten customer (`POST /customers`, scope `write:customers`),
//   2. creates its instance (`POST /instances`, scope `write:instances`), on the licence the contract
//      requires: the catalogue's free plan, never one the visitor names (see `licenceForNewAccount`),
//   3. remembers the account in a signed cookie (`./account-cookie.ts`),
//
// and the session route (`./session-route.ts`) mints the customer's session for that cookie's account
// when the page asks, the way it does for a fixed customer. The visitor then buys a plan with the SDK's
// checkout, as any customer does.
//
// This is a demo of the path, not a sign-up to ship: there is no password, no e-mail confirmation and
// no limit on how many accounts a client can make. A real site puts its own authentication and its own
// abuse protection in front of this route (see the README).

import {
  createKaitenClient,
  CustomerSessions,
  Customers,
  Instances,
  KaitenError,
} from "@kaitencloud/server";

import type { AccountCookie, Account } from "./account-cookie.ts";
import type { Route } from "./http.ts";
import { licenceForNewAccount, type ReadCatalogue } from "./public-catalog.ts";
import type { SessionAccounts } from "./session-route.ts";
import { generateSlug } from "./slug.ts";
import { checkSignUp } from "../src/sign-up-fields.ts";

type Client = ReturnType<typeof createKaitenClient>;

export const ACCOUNT_PATH = "/storefront-api/account";
export const SIGNUP_PATH = "/storefront-api/signup";
export const SIGNOUT_PATH = "/storefront-api/signout";

/** The most a sign-up request can weigh: a name and an address are a few hundred bytes. */
export const BODY_MAX_BYTES = 4096;

/** How many slugs are tried for a customer, and for an instance, when Kaiten says one is taken. */
const SLUG_ATTEMPTS = 3;

/** How long an instance's licence runs, as saas-api registers Kaiten's own: three years. Billing does not read it. */
const LICENCE_YEARS = 3;

/**
 * The sessions this process minted for each account, so that a sign-out can revoke them. The cookie holds
 * slugs and nothing else, so the ids Kaiten gave are kept here: after a restart there is nothing left to
 * revoke, and a session ends by itself in at most an hour.
 */
export class SessionLedger {
  readonly #ids = new Map<string, string[]>();
  readonly #perCustomer: number;

  constructor(perCustomer = 50) {
    this.#perCustomer = perCustomer;
  }

  record(account: Account, id: string): void {
    const ids = this.#ids.get(account.customerSlug) ?? [];
    ids.push(id);
    // The oldest are the likeliest to have ended already.
    if (ids.length > this.#perCustomer) ids.splice(0, ids.length - this.#perCustomer);
    this.#ids.set(account.customerSlug, ids);
  }

  /** The ids kept for an account, which are forgotten with this call. */
  take(account: Account): string[] {
    const ids = this.#ids.get(account.customerSlug) ?? [];
    this.#ids.delete(account.customerSlug);
    return ids;
  }
}

export interface AccountRoutesOptions {
  /** A client that carries a `ksh_` token with `write:customers`, `write:instances` and `write:customer_sessions`. */
  client: Client;
  cookie: AccountCookie;
  /** The plans on sale, read with the publishable key. */
  readCatalogue: ReadCatalogue;
  ledger: SessionLedger;
  /** Whether visitors sign up, asked at each request. Default: yes. */
  signUp?: () => boolean;
  /**
   * Whether the page is told what a developer needs to fix a refusal: the scope the token lacks, that the
   * organization is out of customers or instances, that the catalogue has no free plan. Those are
   * configuration, and a visitor has no use for them: a site that is live says `signup_unavailable` and keeps
   * the rest to its log. Default: no.
   */
  developerDetail?: boolean;
  /** Where a line about a refusal goes. Default: the console's error output. */
  log?: (message: string) => void;
  /** The clock, for the licence's dates. */
  now?: () => Date;
  /** The random part of a generated slug. */
  suffix?: () => string;
}

const NO_STORE = { "Cache-Control": "no-store" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE, ...headers },
  });

/** What stops a sign-up, said to the page: `status` and `body` are its answer. */
class SignUpRefused extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;

  constructor(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    super(String(body.error));
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

/** The scope Kaiten says the token lacks (`missing required scope: write:instances`), or the one the step needs. */
function missingScope(error: KaitenError, fallback: string): string {
  const named = /missing required scope:\s*([a-z_]+:[a-z_]+)/i.exec(error.detail ?? "");
  return named?.[1] ?? fallback;
}

/** Every scope the sign-up needs, as the log and the README say it. */
const SCOPES = "write:customers, write:instances and write:customer_sessions";

export function accountRoutes(options: AccountRoutesOptions): Route {
  const {
    client,
    cookie,
    readCatalogue,
    ledger,
    signUp = () => true,
    developerDetail = false,
  } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  const now = options.now ?? (() => new Date());
  const suffix = options.suffix;

  /**
   * Sends a creation with a slug of the name's, and with another when Kaiten says the slug is taken, up
   * to `SLUG_ATTEMPTS` times: the visitor never sees a collision.
   */
  async function create<T extends { slug?: string }>(
    what: "customer" | "instance",
    name: string,
    send: (slug: string) => Promise<{ data: T }>,
  ): Promise<T & { slug: string }> {
    const conflict =
      what === "customer" ? "CreateCustomer.SlugConflict" : "CreateInstance.SlugConflict";
    for (let attempt = 1; ; attempt += 1) {
      const slug = generateSlug(name, suffix);
      try {
        const { data } = await send(slug);
        return { ...data, slug: data.slug ?? slug };
      } catch (error) {
        const taken =
          error instanceof KaitenError && error.status === 409 && error.code === conflict;
        if (taken && attempt < SLUG_ATTEMPTS) continue;
        throw refusal(error, what, taken);
      }
    }
  }

  /**
   * Makes a customer, and then an instance of it. An instance that cannot be made takes its customer
   * with it, so that a visitor who tries again does not leave a customer behind.
   */
  async function createAccount(name: string, email: string, licenseId: string): Promise<Account> {
    const customer = await create("customer", name, (slug) =>
      Customers.createCustomer({
        client,
        throwOnError: true,
        body: { name, slug, billingEmail: email },
      }),
    );

    try {
      const start = now();
      const end = new Date(start);
      end.setUTCFullYear(end.getUTCFullYear() + LICENCE_YEARS);
      const instance = await create("instance", name, (slug) =>
        Instances.createInstance({
          client,
          throwOnError: true,
          body: {
            name,
            description: "Signed up on the storefront",
            customerId: customer.id,
            licenseId,
            startLicenseDate: start.toISOString(),
            endLicenseDate: end.toISOString(),
            slug,
          },
        }),
      );
      return { customerSlug: customer.slug, instanceSlug: instance.slug };
    } catch (error) {
      await Customers.deleteCustomer({
        client,
        throwOnError: true,
        path: { customerSlug: customer.slug },
      }).catch(() => {
        log("[storefront] The customer made for a sign-up that failed could not be deleted.");
      });
      throw error;
    }
  }

  /** What the page is told of a refusal, and what the log says of it. Never the name or the address. */
  function refusal(
    error: unknown,
    what: "customer" | "instance",
    slugsTaken: boolean,
  ): SignUpRefused {
    const failed = `Kaiten refused to create the ${what}`;
    if (!(error instanceof KaitenError)) {
      log(`[storefront] Kaiten could not be reached to create the ${what}.`);
      return new SignUpRefused(502, { error: "signup_unavailable" });
    }
    if (
      error.status === 403 &&
      (error.code === "Auth.MissingScope" || /missing required scope/i.test(error.detail ?? ""))
    ) {
      const scope = missingScope(
        error,
        what === "customer" ? "write:customers" : "write:instances",
      );
      log(
        `[storefront] ${failed}: KAITEN_API_TOKEN does not hold ${scope}. ` +
          `Sign-up mode needs ${SCOPES} on the server token.`,
      );
      return developerDetail
        ? new SignUpRefused(502, { error: "missing_scope", scope })
        : new SignUpRefused(502, { error: "signup_unavailable" });
    }
    // The contract lists no 429 for these two operations (it lists a 503 with `Retry-After`); a gateway
    // in front of Kaiten can still send one, and a visitor is better told to wait than that it failed.
    if (error.status === 429) {
      log(`[storefront] ${failed}: Kaiten limits the rate (429 ${error.code}).`);
      return new SignUpRefused(
        429,
        { error: "rate_limited" },
        { "Retry-After": String(error.retryAfterSeconds ?? 1) },
      );
    }
    if (error.status === 503) {
      log(`[storefront] ${failed}: Kaiten is unavailable (503 ${error.code}).`);
      return new SignUpRefused(
        503,
        { error: "unavailable" },
        { "Retry-After": String(error.retryAfterSeconds ?? 30) },
      );
    }
    if (error.status === 409 && error.code?.endsWith(".EntitlementLimitReached")) {
      log(`[storefront] ${failed}: your Kaiten organization reached its ${what} limit.`);
      return developerDetail
        ? new SignUpRefused(409, { error: "limit_reached" })
        : new SignUpRefused(502, { error: "signup_unavailable" });
    }
    if (error.status === 422 && error.code === "CreateCustomer.InvalidBillingEmail") {
      log(`[storefront] ${failed}: Kaiten does not accept the e-mail address (422 ${error.code}).`);
      return new SignUpRefused(422, { error: "invalid_email" });
    }
    if (error.status === 401) {
      log("[storefront] Kaiten did not accept KAITEN_API_TOKEN.");
    } else if (slugsTaken) {
      log(`[storefront] ${failed}: ${SLUG_ATTEMPTS} slugs in a row were taken.`);
    } else {
      log(`[storefront] ${failed}: ${error.status} ${error.code}`);
    }
    return new SignUpRefused(502, { error: "signup_unavailable" });
  }

  /** The request's JSON, or the answer to give instead: a body too big, or not JSON, is refused unread. */
  async function readBody(
    request: Request,
  ): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
    const type = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") {
      return { ok: false, response: json(415, { error: "unsupported_media_type" }) };
    }
    const tooBig = { ok: false as const, response: json(413, { error: "too_large" }) };
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > BODY_MAX_BYTES) return tooBig;

    // The declared length is the client's word: count what arrives, and stop reading past the limit.
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = request.body?.getReader();
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > BODY_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return tooBig;
      }
      chunks.push(value);
    }
    try {
      return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown };
    } catch {
      return { ok: true, value: null };
    }
  }

  async function signUpAccount(request: Request): Promise<Response> {
    if (cookie.read(request) !== null) return json(409, { error: "already_signed_in" });

    const body = await readBody(request);
    if (!body.ok) return body.response;
    const checked = checkSignUp(body.value);
    if (!checked.ok) return json(400, { error: "invalid", fields: checked.fields });

    let licenseId: string;
    try {
      const licence = licenceForNewAccount(await readCatalogue());
      if (licence === null) {
        log(
          "[storefront] The catalogue has no free plan, so no visitor can sign up: publish a FREE plan. " +
            "An instance needs a licence and holds its entitlements, so the one a new account starts on is " +
            "never the visitor's to choose.",
        );
        return developerDetail
          ? json(422, { error: "free_plan_required" })
          : json(502, { error: "signup_unavailable" });
      }
      licenseId = licence.licenseId;
    } catch {
      log("[storefront] The public catalogue could not be read to sign a visitor up.");
      return json(502, { error: "signup_unavailable" });
    }

    try {
      const account = await createAccount(checked.name, checked.email, licenseId);
      return json(201, { signedIn: true }, { "Set-Cookie": cookie.set(account, request) });
    } catch (error) {
      if (error instanceof SignUpRefused) return json(error.status, error.body, error.headers);
      log("[storefront] A sign-up failed unexpectedly.");
      return json(502, { error: "signup_unavailable" });
    }
  }

  async function signOut(request: Request): Promise<Response> {
    const account = cookie.read(request);
    if (account !== null) {
      for (const id of ledger.take(account)) {
        await CustomerSessions.revokeCustomerSession({
          client,
          throwOnError: true,
          path: { sessionId: id },
        }).catch(() => log("[storefront] A customer session could not be revoked at sign-out."));
      }
    }
    return new Response(null, {
      status: 204,
      headers: { ...NO_STORE, "Set-Cookie": cookie.clear(request) },
    });
  }

  return async (request) => {
    const { pathname, origin } = new URL(request.url);
    if (pathname !== ACCOUNT_PATH && pathname !== SIGNUP_PATH && pathname !== SIGNOUT_PATH) {
      return undefined;
    }
    const accounts = signUp();

    if (pathname === ACCOUNT_PATH) {
      if (request.method !== "GET") {
        return json(405, { error: "method_not_allowed" }, { Allow: "GET" });
      }
      if (!accounts) return json(200, { accounts: "fixed", signedIn: true });
      const signedIn = cookie.read(request) !== null;
      // A cookie this server did not sign is dropped, rather than sent with every request for good.
      return json(
        200,
        { accounts: "sign-up", signedIn },
        !signedIn && cookie.present(request) ? { "Set-Cookie": cookie.clear(request) } : {},
      );
    }

    if (request.method !== "POST") {
      return json(405, { error: "method_not_allowed" }, { Allow: "POST" });
    }
    // The routes that create and forget accounts are not for every page on the internet.
    const from = request.headers.get("origin");
    if (from !== null && from !== origin) return json(403, { error: "cross_origin" });
    if (!accounts) return json(404, { error: "sign_up_off" });

    return pathname === SIGNUP_PATH ? signUpAccount(request) : signOut(request);
  };
}

/** The accounts the session route mints for: the cookie's, and the ledger that remembers what was minted. */
export function sessionAccounts(cookie: AccountCookie, ledger: SessionLedger): SessionAccounts {
  return {
    of: (request) => cookie.read(request),
    forget: (request) => cookie.clear(request),
    minted: (account, id) => ledger.record(account, id),
  };
}
