// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The routes of a storefront whose visitors sign up, against a Kaiten that is a script: what they send
// it, what they tell the page of each refusal, and what they leave in the log.

import { createKaitenClient } from "@kaitencloud/server";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { createAccountCookie, ACCOUNT_COOKIE } from "../server/account-cookie.ts";
import {
  ACCOUNT_PATH,
  accountRoutes,
  SessionLedger,
  sessionAccounts,
  SIGNOUT_PATH,
  BODY_MAX_BYTES,
  SIGNUP_PATH,
} from "../server/account-routes.ts";
import {
  catalogueReader,
  licenceForNewAccount,
  type CataloguePlan,
} from "../server/public-catalog.ts";
import { SESSION_PATH, sessionRoute } from "../server/session-route.ts";

const ORIGIN = "https://storefront.test";
const SERVER_TOKEN = `ksh_${"s".repeat(43)}`;
const PUBLISHABLE_KEY = `pk_${"p".repeat(43)}`;
const STARTER = "00000000-0000-4000-8000-000000000001";
const PRO = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-21T10:00:00.000Z");

const FREE_AND_PAID: CataloguePlan[] = [
  { licenseId: PRO, licenseSlug: "pro-v2", pricingType: "PAID" },
  { licenseId: STARTER, licenseSlug: "starter-v1", pricingType: "FREE" },
];
/** A catalogue with no free plan: a paid one, a bespoke one and a paid one that cannot be bought alone. */
const PAID_ONLY: (CataloguePlan & { selfServe?: boolean })[] = [
  { licenseId: PRO, licenseSlug: "pro-v2", pricingType: "PAID", selfServe: true },
  {
    licenseId: "00000000-0000-4000-8000-000000000005",
    licenseSlug: "enterprise-v1",
    pricingType: "CUSTOM",
    selfServe: false,
  },
  {
    licenseId: "00000000-0000-4000-8000-000000000006",
    licenseSlug: "scale-v1",
    pricingType: "PAID",
    selfServe: false,
  },
];

interface Sent {
  method: string;
  path: string;
  authorization: string | null;
  origin: string | null;
  body: any;
}

const problem = (
  status: number,
  code: string,
  detail = "the detail",
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ type: "about:blank", title: "Refused", status, detail, code }), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });

const created = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let minted = 0;

/** What a Kaiten that is well answers, unless a test scripts a route in front of it. */
function fine(sent: Sent): Response {
  const key = `${sent.method} ${sent.path}`;
  if (key === "POST /customers") {
    return created(201, {
      id: `id-of-${sent.body.slug}`,
      name: sent.body.name,
      slug: sent.body.slug,
      billingEmail: sent.body.billingEmail,
      createdAt: NOW.toISOString(),
      createdBy: { id: "svc" },
      updatedAt: NOW.toISOString(),
      updatedBy: { id: "svc" },
    });
  }
  if (key === "POST /instances")
    return created(201, { id: `id-of-${sent.body.slug}`, ...sent.body });
  if (key === "POST /customer-sessions") {
    return created(201, {
      id: `session-${++minted}`,
      token: `kst_${"k".repeat(43)}`,
      expiresAt: "2026-10-21T10:30:00Z",
      customerSlug: sent.body.customerSlug,
      instanceSlug: sent.body.instanceSlug,
    });
  }
  if (key.startsWith("DELETE /customers/") || key.endsWith("/revoke")) {
    return new Response(null, { status: 204 });
  }
  return problem(404, "NotFound", `no ${key}`);
}

/**
 * The storefront's backend in sign-up mode against a scripted Kaiten. `script` gives the next answers to
 * `METHOD /path`, in turn; a thrown value is a Kaiten that could not be reached.
 */
function backend(
  options: {
    plans?: CataloguePlan[] | Error;
    script?: Record<string, Array<Response | Error>>;
    signUp?: boolean;
    secret?: string;
    /** Whether the page is told what a developer needs; the tests are written as one by default. */
    developerDetail?: boolean;
  } = {},
) {
  minted = 0;
  const sent: Sent[] = [];
  const queues = new Map(
    Object.entries(options.script ?? {}).map(([key, each]) => [key, [...each]]),
  );
  const fetchKaiten: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const at: Sent = {
      method: request.method,
      path: new URL(request.url).pathname.replace(/^\/api/, ""),
      authorization: request.headers.get("authorization"),
      origin: request.headers.get("origin"),
      body: text ? JSON.parse(text) : undefined,
    };
    sent.push(at);
    const next = queues.get(`${at.method} ${at.path}`)?.shift();
    if (next instanceof Error) throw next;
    return next ?? fine(at);
  };

  const client = createKaitenClient({
    baseUrl: "https://kaiten.test",
    token: SERVER_TOKEN,
    fetch: fetchKaiten,
  });
  const cookie = createAccountCookie(options.secret ?? "s".repeat(40));
  const ledger = new SessionLedger();
  const log: string[] = [];
  const signUp = () => options.signUp ?? true;

  const accounts = accountRoutes({
    client,
    cookie,
    ledger,
    signUp,
    developerDetail: options.developerDetail ?? true,
    readCatalogue: async () => {
      const plans = options.plans ?? FREE_AND_PAID;
      if (plans instanceof Error) throw plans;
      return plans;
    },
    log: (message) => log.push(message),
    now: () => NOW,
  });
  const session = sessionRoute({
    client,
    customerSlug: "acme-customer",
    instanceSlug: "acme-instance",
    accounts: sessionAccounts(cookie, ledger),
    signUp,
  });

  const call = (route: typeof accounts, path: string, init: RequestInit = {}) =>
    route(new Request(`${ORIGIN}${path}`, init));
  const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
    accounts(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    ) as Promise<Response>;
  /** A POST whose body and headers are exactly these: for what `post` would make right. */
  const raw = (path: string, init: RequestInit) =>
    accounts(new Request(`${ORIGIN}${path}`, { method: "POST", ...init })) as Promise<Response>;

  /** Signs a visitor up and returns the cookie header the browser would send next. */
  const signUpAs = async (name = "Initech", email = "billing@initech.test", plan?: string) => {
    const response = await post(SIGNUP_PATH, { name, email, plan });
    expect(response.status).toBe(201);
    const set = response.headers.get("set-cookie")!;
    return { response, cookie: set.split(";")[0]! };
  };

  return { sent, log, cookie, ledger, accounts, session, call, post, raw, signUpAs };
}

const withCookie = (cookie: string, init: RequestInit = {}) => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), cookie },
});

afterEach(() => vi.restoreAllMocks());

const VISITOR = { name: "Initech", email: "billing@initech.test" };

/** The log of a run, as one string: what it must not hold is searched for in it. */
const everything = (log: string[], spy: { mock: { calls: unknown[][] } }) =>
  JSON.stringify([log, spy.mock.calls]);

describe("signing a visitor up", () => {
  test("creates the customer and then its instance, with the server token and no Origin", async () => {
    const { sent, post } = backend();

    const response = await post(SIGNUP_PATH, { ...VISITOR, plan: "pro-v2" });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ signedIn: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(sent.map((each) => `${each.method} ${each.path}`)).toEqual([
      "POST /customers",
      "POST /instances",
    ]);
    for (const each of sent) {
      expect(each.authorization).toBe(`Bearer ${SERVER_TOKEN}`);
      expect(each.origin).toBeNull();
    }

    const [customer, instance] = sent;
    expect(customer!.body).toEqual({
      name: "Initech",
      slug: expect.stringMatching(/^initech-[0-9a-f]{6}$/),
      billingEmail: "billing@initech.test",
    });
    // The instance of that customer (by id), on the free plan's licence, for the three years of Kaiten's own.
    expect(instance!.body).toEqual({
      name: "Initech",
      description: "Signed up on the storefront",
      customerId: `id-of-${customer!.body.slug}`,
      licenseId: STARTER,
      startLicenseDate: "2026-10-21T10:00:00.000Z",
      endLicenseDate: "2029-10-21T10:00:00.000Z",
      slug: expect.stringMatching(/^initech-[0-9a-f]{6}$/),
    });
    expect(instance!.body.slug).not.toBe(customer!.body.slug);
  });

  test("remembers the two slugs in a signed cookie, and nothing else", async () => {
    const { sent, post, cookie } = backend();

    const response = await post(SIGNUP_PATH, VISITOR);

    const set = response.headers.get("set-cookie")!;
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    const value = set.split(";")[0]!.slice(`${ACCOUNT_COOKIE}=`.length);
    expect(cookie.verify(value)).toEqual({
      customerSlug: sent[0]!.body.slug,
      instanceSlug: sent[1]!.body.slug,
    });
    expect(set).not.toContain("Initech");
    expect(set).not.toContain("billing@");
  });

  test("starts the instance on the free plan, whatever plan the request names", async () => {
    const { sent, post } = backend();

    // A caller names the dearest plan, a bespoke one, one that is not on sale: none of it is read.
    for (const plan of ["pro-v2", "enterprise-v1", "nothing-v1", 7, {}]) {
      const response = await post(SIGNUP_PATH, { ...VISITOR, plan });
      expect(response.status).toBe(201);
    }

    const instances = sent.filter((each) => each.path === "/instances");
    expect(instances).toHaveLength(5);
    for (const each of instances) expect(each.body.licenseId).toBe(STARTER);
  });

  test("with no free plan there is no sign-up, whatever plan the request names, and nothing is created", async () => {
    const { sent, post, log } = backend({ plans: PAID_ONLY });

    // The paid plan that can be bought alone, a bespoke one, one that cannot be bought alone, one that
    // is not there, and none: Kaiten is asked for nothing, and no entitlement is given away.
    for (const plan of ["pro-v2", "enterprise-v1", "scale-v1", "nothing-v1", undefined]) {
      const response = await post(SIGNUP_PATH, { ...VISITOR, plan });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: "free_plan_required" });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(sent).toEqual([]);
    expect(log.join()).toContain("no free plan");
    expect(log.join()).toContain("publish a FREE plan");
  });

  test("a visitor is told nothing of the catalogue: only a developer hears that a free plan is missing", async () => {
    const { sent, post, log } = backend({ plans: PAID_ONLY, developerDetail: false });

    const response = await post(SIGNUP_PATH, { ...VISITOR, plan: "pro-v2" });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "signup_unavailable" });
    expect(sent).toEqual([]);
    // The detail is for the log all the same.
    expect(log.join()).toContain("publish a FREE plan");
  });

  test("the licence is the free plan's, and a paid, bespoke or unbuyable plan is never one", () => {
    expect(licenceForNewAccount(FREE_AND_PAID)?.licenseId).toBe(STARTER);
    expect(licenceForNewAccount(PAID_ONLY)).toBeNull();
    expect(licenceForNewAccount([])).toBeNull();
    // Whichever order the catalogue lists them in.
    expect(licenceForNewAccount([...FREE_AND_PAID].reverse())?.licenseId).toBe(STARTER);
  });

  test("reads the catalogue with the publishable key and no Origin", async () => {
    const requests: Request[] = [];
    const read = catalogueReader({
      apiUrl: "https://kaiten.test/api/",
      publishableKey: PUBLISHABLE_KEY,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        return new Response(JSON.stringify({ plans: FREE_AND_PAID, addOns: [] }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    expect(await read()).toEqual(FREE_AND_PAID);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://kaiten.test/api/public/catalog");
    expect(requests[0]!.headers.get("x-kaiten-publishable-key")).toBe(PUBLISHABLE_KEY);
    expect(requests[0]!.headers.get("authorization")).toBeNull();
    expect(requests[0]!.headers.get("origin")).toBeNull();
  });

  test("a URL without /api is read under /api, as the server SDK does", async () => {
    const urls: string[] = [];
    const read = catalogueReader({
      apiUrl: "https://kaiten.test",
      publishableKey: PUBLISHABLE_KEY,
      fetch: async (input) => {
        urls.push(new Request(input).url);
        return new Response(JSON.stringify({ plans: [] }));
      },
    });
    await read();
    expect(urls).toEqual(["https://kaiten.test/api/public/catalog"]);
  });

  test.each([
    ["nothing", undefined, { name: "required", email: "required" }],
    [
      "a blank name and a blank address",
      { name: "   ", email: " " },
      { name: "required", email: "required" },
    ],
    ["an address that is not one", { name: "Initech", email: "initech" }, { email: "invalid" }],
    ["a name that is too long", { name: "x".repeat(101), email: "a@b.co" }, { name: "too_long" }],
    [
      "an address that is too long",
      { name: "Initech", email: `${"x".repeat(250)}@b.co` },
      { email: "too_long" },
    ],
    ["values that are not text", { name: 1, email: [] }, { name: "required", email: "required" }],
  ])("refuses %s before it asks Kaiten for anything", async (_name, body, fields) => {
    const { sent, post } = backend();

    const response = await post(SIGNUP_PATH, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid", fields });
    expect(sent).toEqual([]);
  });

  test("refuses a body that is not JSON the same way", async () => {
    const { sent, raw } = backend();
    for (const body of ["nope", "", "[", "null", "42"]) {
      const response = await raw(SIGNUP_PATH, {
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "invalid" });
    }
    expect(sent).toEqual([]);
  });

  test.each([
    ["no content type", undefined],
    ["text", "text/plain"],
    ["a form", "application/x-www-form-urlencoded"],
    ["something that only starts like JSON", "application/jsonp"],
  ])("takes JSON only: %s is a 415, and nothing is read or sent", async (_name, type) => {
    const { sent, raw } = backend();

    const response = await raw(SIGNUP_PATH, {
      headers: type === undefined ? {} : { "Content-Type": type },
      body: JSON.stringify(VISITOR),
    });

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    expect(sent).toEqual([]);
  });

  test("takes JSON with a charset, in any case", async () => {
    const { raw } = backend();
    const response = await raw(SIGNUP_PATH, {
      headers: { "Content-Type": "Application/JSON; charset=utf-8" },
      body: JSON.stringify(VISITOR),
    });
    expect(response.status).toBe(201);
  });

  test("refuses a body over the limit, whatever it declares, and stops reading it", async () => {
    const { sent, raw } = backend();

    // It says so: the declared length is enough.
    const declared = await raw(SIGNUP_PATH, {
      headers: { "Content-Type": "application/json", "Content-Length": String(BODY_MAX_BYTES + 1) },
      body: JSON.stringify(VISITOR),
    });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "too_large" });

    // It does not say so, or lies: what arrives is counted, and the stream is cancelled past the limit.
    let pulled = 0;
    let cancelled = false;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const streamed = await raw(SIGNUP_PATH, {
      headers: { "Content-Type": "application/json", "Content-Length": "10" },
      body: endless,
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);
    expect(cancelled).toBe(true);
    // A few chunks past the limit at most, not the whole of an endless body.
    expect(pulled).toBeLessThan(20);
    expect(sent).toEqual([]);
  });

  test("takes a body at the limit", async () => {
    const { raw } = backend();
    const padding = "x".repeat(BODY_MAX_BYTES - JSON.stringify({ ...VISITOR, pad: "" }).length);
    const body = JSON.stringify({ ...VISITOR, pad: padding });
    expect(new TextEncoder().encode(body).byteLength).toBe(BODY_MAX_BYTES);
    const response = await raw(SIGNUP_PATH, {
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(201);
  });

  test.each([
    ["a line break", "Init\nech", { name: "invalid" }],
    ["a tab", "Init\tech", { name: "invalid" }],
    ["a NUL", "Init\u0000ech", { name: "invalid" }],
    ["a zero-width space", "Init\u200Bech", { name: "invalid" }],
    ["a bidirectional override", "Init\u202Eech", { name: "invalid" }],
    ["nothing but a zero-width space", "\u200B", { name: "invalid" }],
    ["a name that is blank once trimmed", " \u00A0 ", { name: "required" }],
    ["a name that is only a joiner", "\u200C", { name: "required" }],
  ])("refuses a name with %s before it asks Kaiten for anything", async (_name, name, fields) => {
    const { sent, post } = backend();

    const response = await post(SIGNUP_PATH, { name, email: "billing@initech.test" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid", fields });
    expect(sent).toEqual([]);
  });

  test("refuses an address with a hidden character in it", async () => {
    const { sent, post } = backend();
    const response = await post(SIGNUP_PATH, {
      name: "Initech",
      email: "bill\u200Bing@initech.test",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid", fields: { email: "invalid" } });
    expect(sent).toEqual([]);
  });

  test("takes a name with letters of any script, an apostrophe, an ampersand and an emoji", async () => {
    const { sent, post } = backend();
    for (const name of ["Café Münster", "日本の会社", "O’Brien & Sons", "Pizza 🍕", "می‌خواهم"]) {
      expect((await post(SIGNUP_PATH, { name, email: "a@b.co" })).status).toBe(201);
    }
    expect(sent.filter((each) => each.path === "/customers")).toHaveLength(5);
  });

  test("trims what the visitor typed", async () => {
    const { sent, post } = backend();
    await post(SIGNUP_PATH, { name: "  Initech  ", email: "  billing@initech.test " });
    expect(sent[0]!.body).toMatchObject({ name: "Initech", billingEmail: "billing@initech.test" });
  });

  test("takes a POST only, from its own origin, and from a visitor who has no account", async () => {
    const { sent, post, call, accounts, signUpAs } = backend();

    const wrongMethod = await call(accounts, SIGNUP_PATH);
    expect(wrongMethod?.status).toBe(405);
    expect(wrongMethod?.headers.get("allow")).toBe("POST");

    const elsewhere = await post(SIGNUP_PATH, VISITOR, { Origin: "https://elsewhere.test" });
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.json()).toEqual({ error: "cross_origin" });
    expect((await post(SIGNUP_PATH, VISITOR, { Origin: ORIGIN })).status).toBe(201);

    // Signed in already: no second account.
    const { cookie } = await signUpAs();
    const before = sent.length;
    const again = await accounts(
      new Request(`${ORIGIN}${SIGNUP_PATH}`, {
        method: "POST",
        headers: { cookie },
        body: JSON.stringify(VISITOR),
      }),
    );
    expect(again?.status).toBe(409);
    expect(await again?.json()).toEqual({ error: "already_signed_in" });
    expect(sent).toHaveLength(before);
  });

  test("is not a route of a storefront that has one customer", async () => {
    const { sent, post, call, accounts } = backend({ signUp: false });

    for (const path of [SIGNUP_PATH, SIGNOUT_PATH]) {
      const response = await post(path, VISITOR);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "sign_up_off" });
    }
    const account = await call(accounts, ACCOUNT_PATH);
    expect(await account?.json()).toEqual({ accounts: "fixed", signedIn: true });
    expect(sent).toEqual([]);
  });

  test("is not for any other path", async () => {
    const { call, accounts } = backend();
    expect(await call(accounts, "/storefront-api/other", { method: "POST" })).toBeUndefined();
  });
});

describe("what a sign-up tells the page of Kaiten's refusals", () => {
  test("a slug that is taken is tried again with another suffix, and the visitor never knows", async () => {
    const { sent, post } = backend({
      script: { "POST /customers": [problem(409, "CreateCustomer.SlugConflict")] },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(201);
    const customers = sent.filter((each) => each.path === "/customers");
    expect(customers).toHaveLength(2);
    expect(customers[0]!.body.slug).not.toBe(customers[1]!.body.slug);
    expect(customers[1]!.body.slug).toMatch(/^initech-[0-9a-f]{6}$/);
  });

  test("so is an instance's slug, without making the customer again", async () => {
    const { sent, post } = backend({
      script: { "POST /instances": [problem(409, "CreateInstance.SlugConflict")] },
    });

    expect((await post(SIGNUP_PATH, VISITOR)).status).toBe(201);
    expect(sent.filter((each) => each.path === "/customers")).toHaveLength(1);
    expect(sent.filter((each) => each.path === "/instances")).toHaveLength(2);
  });

  test("three slugs in a row that are taken is a sign-up that cannot be made", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const taken = problem(409, "CreateCustomer.SlugConflict");
    const { sent, post, log } = backend({
      script: {
        "POST /customers": [
          taken,
          problem(409, "CreateCustomer.SlugConflict"),
          problem(409, "CreateCustomer.SlugConflict"),
        ],
      },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "signup_unavailable" });
    expect(sent.filter((each) => each.path === "/customers")).toHaveLength(3);
    expect(sent.some((each) => each.path === "/instances")).toBe(false);
    expect(log.join()).toContain("slugs in a row were taken");
    spy.mockRestore();
  });

  test("a customer limit is said to the developer, and the visitor is told it cannot be done", async () => {
    const { post, log } = backend({
      script: { "POST /customers": [problem(409, "CreateCustomer.EntitlementLimitReached")] },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "limit_reached" });
    expect(log.join()).toContain("reached its customer limit");
  });

  test("an instance limit takes the customer back", async () => {
    const { sent, post, log } = backend({
      script: { "POST /instances": [problem(409, "CreateInstance.EntitlementLimitReached")] },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "limit_reached" });
    expect(log.join()).toContain("reached its instance limit");
    expect(sent.at(-1)).toMatchObject({ method: "DELETE" });
  });

  test("a token without write:customers is named, with what sign-up mode needs", async () => {
    const { post, log } = backend({
      script: {
        "POST /customers": [
          problem(403, "Auth.MissingScope", "missing required scope: write:customers"),
        ],
      },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "missing_scope", scope: "write:customers" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(log.join()).toContain("KAITEN_API_TOKEN does not hold write:customers");
    expect(log.join()).toContain("write:customers, write:instances and write:customer_sessions");
  });

  test("a token without write:instances is named, and the customer made a moment before is deleted", async () => {
    const { sent, post, log } = backend({
      script: {
        "POST /instances": [
          problem(403, "Auth.MissingScope", "missing required scope: write:instances"),
        ],
      },
    });

    const response = await post(SIGNUP_PATH, VISITOR);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "missing_scope", scope: "write:instances" });
    expect(log.join()).toContain("KAITEN_API_TOKEN does not hold write:instances");
    const [customer, , removal] = sent;
    expect(removal).toMatchObject({
      method: "DELETE",
      path: `/customers/${customer!.body.slug}`,
      authorization: `Bearer ${SERVER_TOKEN}`,
    });
  });

  test.each([
    [
      "a token without write:customers",
      {
        "POST /customers": [
          problem(403, "Auth.MissingScope", "missing required scope: write:customers"),
        ],
      },
      "does not hold write:customers",
    ],
    [
      "a token without write:instances",
      {
        "POST /instances": [
          problem(403, "Auth.MissingScope", "missing required scope: write:instances"),
        ],
      },
      "does not hold write:instances",
    ],
    [
      "a customer limit",
      { "POST /customers": [problem(409, "CreateCustomer.EntitlementLimitReached")] },
      "reached its customer limit",
    ],
    [
      "an instance limit",
      { "POST /instances": [problem(409, "CreateInstance.EntitlementLimitReached")] },
      "reached its instance limit",
    ],
  ])(
    "tells a visitor nothing of the configuration behind %s, and keeps it for the log",
    async (_name, script, logged) => {
      const { post, log } = backend({ script, developerDetail: false });

      const response = await post(SIGNUP_PATH, VISITOR);

      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "signup_unavailable" });
      expect(text).not.toContain("write:");
      expect(text).not.toContain("scope");
      expect(log.join()).toContain(logged);
      expect(response.headers.get("set-cookie")).toBeNull();
    },
  );

  test("a scope that Kaiten does not name is the one the step needs", async () => {
    const { post } = backend({
      script: { "POST /instances": [problem(403, "Auth.MissingScope", "forbidden")] },
    });
    expect(await (await post(SIGNUP_PATH, VISITOR)).json()).toEqual({
      error: "missing_scope",
      scope: "write:instances",
    });
  });

  test("a 403 that is not a missing scope is not called one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { post } = backend({
      script: { "POST /customers": [problem(403, "Auth.Forbidden", "not for you")] },
    });
    const response = await post(SIGNUP_PATH, VISITOR);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "signup_unavailable" });
  });

  test("an address Kaiten does not accept is said to be the address", async () => {
    const { post } = backend({
      script: { "POST /customers": [problem(422, "CreateCustomer.InvalidBillingEmail")] },
    });
    const response = await post(SIGNUP_PATH, VISITOR);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_email" });
  });

  // The contract lists no 429 for these two operations (a 503 with Retry-After is what it documents), so this
  // is a precaution for a gateway in front of Kaiten, and not a Kaiten behaviour.
  test.each([
    ["customers", "POST /customers", "CreateCustomer.RateLimited"],
    ["instances", "POST /instances", "CreateInstance.RateLimited"],
  ])(
    "passes on the wait a gateway asks for with a 429 on the creation of %s",
    async (_name, key, code) => {
      const { post } = backend({
        script: { [key]: [problem(429, code, "slow down", { "Retry-After": "7" })] },
      });

      const response = await post(SIGNUP_PATH, VISITOR);

      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("7");
      expect(await response.json()).toEqual({ error: "rate_limited" });
    },
  );

  test("passes on the wait when Kaiten is unavailable", async () => {
    const { post } = backend({
      script: {
        "POST /customers": [
          problem(503, "CreateCustomer.ProviderUnavailable", "later", { "Retry-After": "45" }),
        ],
      },
    });
    const response = await post(SIGNUP_PATH, VISITOR);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  test.each([
    [
      "a token Kaiten refuses",
      { "POST /customers": [problem(401, "Auth.InvalidCredential")] },
      "did not accept KAITEN_API_TOKEN",
    ],
    [
      "a licence Kaiten does not know",
      { "POST /instances": [problem(404, "CreateInstance.LicenseNotFound")] },
      "CreateInstance.LicenseNotFound",
    ],
    [
      "a licence that is archived",
      { "POST /instances": [problem(422, "CreateInstance.LicenseArchived")] },
      "CreateInstance.LicenseArchived",
    ],
    ["a Kaiten that fails", { "POST /customers": [problem(500, "Internal")] }, "500 Internal"],
    [
      "a Kaiten that cannot be reached",
      { "POST /customers": [new TypeError("fetch failed")] },
      "could not be reached",
    ],
  ])(
    "says that sign-up is unavailable, and nothing of why, for %s",
    async (_name, script, logged) => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { post, log } = backend({ script });

      const response = await post(SIGNUP_PATH, VISITOR);

      expect(response.status).toBe(502);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: "signup_unavailable" });
      expect(text).not.toContain("the detail");
      expect(log.join()).toContain(logged);
      expect(response.headers.get("set-cookie")).toBeNull();
      spy.mockRestore();
    },
  );

  test("a catalogue that cannot be read is a sign-up that cannot be made, and creates nothing", async () => {
    const { sent, post, log } = backend({ plans: new Error("down") });
    const response = await post(SIGNUP_PATH, VISITOR);
    expect(response.status).toBe(502);
    expect(sent).toEqual([]);
    expect(log.join()).toContain("catalogue could not be read");
  });

  test("never writes the name, the address or a token in the log", async () => {
    const { post, log } = backend({
      script: {
        "POST /instances": [
          problem(403, "Auth.MissingScope", "missing required scope: write:instances"),
        ],
        "POST /customers": [
          problem(429, "CreateCustomer.RateLimited", "slow", { "Retry-After": "2" }),
        ],
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await post(SIGNUP_PATH, { name: "Secret Name Inc", email: "private@person.test" });
    await post(SIGNUP_PATH, { name: "Secret Name Inc", email: "private@person.test" });
    const text = everything(log, spy);
    for (const secret of ["Secret Name", "private@person", SERVER_TOKEN, "ksh_"]) {
      expect(text).not.toContain(secret);
    }
    expect(log.length).toBeGreaterThan(0);
  });
});

describe("who the visitor is", () => {
  test("a visitor with no cookie is not signed in, and nothing is cleared", async () => {
    const { call, accounts } = backend();
    const response = await call(accounts, ACCOUNT_PATH);
    expect(await response?.json()).toEqual({ accounts: "sign-up", signedIn: false });
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  test("a visitor who signed up is signed in", async () => {
    const { call, accounts, signUpAs } = backend();
    const { cookie } = await signUpAs();
    const response = await call(accounts, ACCOUNT_PATH, withCookie(cookie));
    expect(await response?.json()).toEqual({ accounts: "sign-up", signedIn: true });
  });

  test("a cookie this server did not sign is not an account, and is cleared", async () => {
    const { call, accounts } = backend();
    const forged = `${ACCOUNT_COOKIE}=v1.${Buffer.from('{"c":"initech-aaaaaa","i":"initech-bbbbbb"}').toString("base64url")}.${"A".repeat(43)}`;

    const response = await call(accounts, ACCOUNT_PATH, withCookie(forged));

    expect(await response?.json()).toEqual({ accounts: "sign-up", signedIn: false });
    expect(response?.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("the route takes a GET only", async () => {
    const { post } = backend();
    const response = await post(ACCOUNT_PATH);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("the session of a visitor who signed up", () => {
  const postSession = (route: ReturnType<typeof backend>["session"], init: RequestInit = {}) =>
    route(
      new Request(`${ORIGIN}${SESSION_PATH}`, { method: "POST", ...init }),
    ) as Promise<Response>;

  test("is minted for the account of the cookie, and for no other", async () => {
    const { sent, session, signUpAs } = backend();
    const { cookie } = await signUpAs();
    const { customerSlug, instanceSlug } = {
      customerSlug: sent[0]!.body.slug,
      instanceSlug: sent[1]!.body.slug,
    };

    const response = await postSession(session, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      token: `kst_${"k".repeat(43)}`,
      expiresAt: "2026-10-21T10:30:00Z",
    });
    expect(sent.at(-1)).toMatchObject({
      method: "POST",
      path: "/customer-sessions",
      body: { customerSlug, instanceSlug, ttlSeconds: 1800 },
    });
  });

  test.each([
    ["no cookie", () => ({})],
    [
      "a cookie that was altered",
      (cookie: string) => ({ headers: { cookie: cookie.slice(0, -3) + "AAA" } }),
    ],
    [
      "a cookie of another secret",
      () => ({
        headers: {
          cookie: `${ACCOUNT_COOKIE}=${createAccountCookie("z".repeat(40)).sign({ customerSlug: "initech-aaaaaa", instanceSlug: "initech-bbbbbb" })}`,
        },
      }),
    ],
  ])("mints nothing for %s", async (_name, init) => {
    const { sent, session, signUpAs } = backend();
    const { cookie } = await signUpAs();
    const before = sent.length;

    const response = await postSession(session, init(cookie));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "signed_out" });
    expect(sent).toHaveLength(before);
  });

  test("a customer Kaiten no longer knows is a visitor again, and the cookie is dropped", async () => {
    const { session, signUpAs } = backend({
      script: {
        "POST /customer-sessions": [problem(404, "CreateCustomerSession.CustomerNotFound")],
      },
    });
    const { cookie } = await signUpAs();

    const response = await postSession(session, { headers: { cookie } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "signed_out" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("an instance Kaiten no longer knows is the same", async () => {
    const { session, signUpAs } = backend({
      script: {
        "POST /customer-sessions": [problem(404, "CreateCustomerSession.InstanceNotFound")],
      },
    });
    const { cookie } = await signUpAs();
    const response = await postSession(session, { headers: { cookie } });
    expect(response.status).toBe(401);
  });

  test("other refusals are the page's 502, as for a fixed customer, and a missing scope is named in the log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { session, signUpAs } = backend({
      script: {
        "POST /customer-sessions": [
          problem(403, "Auth.MissingScope", "missing required scope: write:customer_sessions"),
        ],
      },
    });
    const { cookie } = await signUpAs();

    const response = await postSession(session, { headers: { cookie } });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "session_unavailable" });
    expect(JSON.stringify(spy.mock.calls)).toContain("does not hold write:customer_sessions");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("a storefront with one customer ignores the cookie and mints for that customer", async () => {
    const { sent, session } = backend({ signUp: false });
    // A cookie from an earlier life of the same server is of no consequence.
    const forged = `${ACCOUNT_COOKIE}=${createAccountCookie("s".repeat(40)).sign({ customerSlug: "initech-aaaaaa", instanceSlug: "initech-bbbbbb" })}`;

    const response = await postSession(session, { headers: { cookie: forged } });

    expect(response.status).toBe(200);
    expect(sent.at(-1)!.body).toMatchObject({
      customerSlug: "acme-customer",
      instanceSlug: "acme-instance",
    });
  });
});

describe("signing out", () => {
  const signOut = (accounts: ReturnType<typeof backend>["accounts"], cookie?: string) =>
    accounts(
      new Request(`${ORIGIN}${SIGNOUT_PATH}`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
      }),
    ) as Promise<Response>;
  const postSession = (route: ReturnType<typeof backend>["session"], cookie: string) =>
    route(
      new Request(`${ORIGIN}${SESSION_PATH}`, { method: "POST", headers: { cookie } }),
    ) as Promise<Response>;

  test("revokes what was minted for the account, clears the cookie, and answers 204", async () => {
    const { sent, session, accounts, signUpAs } = backend();
    const { cookie } = await signUpAs();
    await postSession(session, cookie);
    await postSession(session, cookie);
    expect(sent.filter((each) => each.path === "/customer-sessions")).toHaveLength(2);

    const response = await signOut(accounts, cookie);

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    const revoked = sent.filter((each) => each.path.endsWith("/revoke"));
    expect(revoked.map((each) => each.path)).toEqual([
      "/customer-sessions/session-1/revoke",
      "/customer-sessions/session-2/revoke",
    ]);
    for (const each of revoked) expect(each.authorization).toBe(`Bearer ${SERVER_TOKEN}`);
  });

  test("is idempotent: the second time there is nothing left to revoke", async () => {
    const { sent, session, accounts, signUpAs } = backend();
    const { cookie } = await signUpAs();
    await postSession(session, cookie);

    await signOut(accounts, cookie);
    const revokedOnce = sent.filter((each) => each.path.endsWith("/revoke")).length;
    const again = await signOut(accounts, cookie);

    expect(again.status).toBe(204);
    expect(sent.filter((each) => each.path.endsWith("/revoke"))).toHaveLength(revokedOnce);
  });

  test("does not revoke the sessions of another account", async () => {
    const { sent, session, accounts, signUpAs } = backend();
    const first = await signUpAs("Initech");
    const second = await signUpAs("Globex", "ap@globex.test");
    await postSession(session, first.cookie);
    await postSession(session, second.cookie);

    await signOut(accounts, first.cookie);

    expect(sent.filter((each) => each.path.endsWith("/revoke"))).toHaveLength(1);
  });

  test("a visitor with no cookie, or a cookie that is no account, is signed out all the same", async () => {
    const { sent, accounts } = backend();
    const none = await signOut(accounts);
    const junk = await signOut(accounts, `${ACCOUNT_COOKIE}=junk`);
    expect(none.status).toBe(204);
    expect(junk.status).toBe(204);
    expect(none.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(sent).toEqual([]);
  });

  test("a session Kaiten will not revoke does not keep the visitor signed in", async () => {
    const { session, accounts, signUpAs, log } = backend({
      script: { "POST /customer-sessions/session-1/revoke": [problem(500, "Internal")] },
    });
    const { cookie } = await signUpAs();
    await postSession(session, cookie);

    const response = await signOut(accounts, cookie);

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(log.join()).toContain("could not be revoked");
  });

  test("takes a POST only, from its own origin", async () => {
    const { call, accounts, post } = backend();
    expect((await call(accounts, SIGNOUT_PATH))?.status).toBe(405);
    expect((await post(SIGNOUT_PATH, undefined, { Origin: "https://elsewhere.test" })).status).toBe(
      403,
    );
  });
});
