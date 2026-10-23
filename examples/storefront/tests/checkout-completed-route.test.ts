// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// `POST /storefront-api/checkout/completed`: the route that names the customer an anonymous checkout
// made after the buyer's company. Called as the page calls it, with the server token held by the
// route and a stand-in for Kaiten behind it. The page is the visitor's, so most of these tests are
// about what the route will not do.

import { KaitenAnonymousCheckoutClient } from "@kaitencloud/client";
import { createKaitenClient, Customers, Instances } from "@kaitencloud/server";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  CHECKOUT_COMPLETED_PATH,
  checkoutCompletedRoute,
} from "../server/checkout-completed-route.ts";
import { createKaitenDouble, DOUBLE_PATH } from "../server/double/kaiten-double.ts";

const ORIGIN = "https://storefront.test";
const API = `${ORIGIN}${DOUBLE_PATH}/api`;
const PUBLISHABLE_KEY = `pk_${"p".repeat(43)}`;
const SERVER_TOKEN = `ksh_${"s".repeat(43)}`;
const STARTER_MONTHLY = "00000000-0000-4000-8000-000000000101";
const STARTER_LICENCE = "00000000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.restoreAllMocks();
});

let tokens = 0;

function shop() {
  const double = createKaitenDouble({ serverToken: SERVER_TOKEN, publishableKey: PUBLISHABLE_KEY });
  double.reset({ anonymousCheckout: true });
  const fetchDouble: typeof fetch = async (input, init) => {
    const response = await double.route(new Request(input, init));
    if (!response) throw new TypeError("the stand-in has no such route");
    return response;
  };
  const client = createKaitenClient({ baseUrl: API, token: SERVER_TOKEN, fetch: fetchDouble });
  const route = checkoutCompletedRoute({ client });
  const checkout = new KaitenAnonymousCheckoutClient({
    apiUrl: API,
    publishableKey: PUBLISHABLE_KEY,
    fetch: fetchDouble,
    storage: null,
  });

  /** A visitor buys the free plan; what Kaiten made is what the page is told. */
  const buy = async (email = "ada@acme.test") => {
    const opened = await checkout.startCheckout({
      turnstileToken: `XXXX.DUMMY.TOKEN.${++tokens}`,
      priceId: STARTER_MONTHLY,
      email,
      returnUrl: `${ORIGIN}/checkout/starter-v1`,
    });
    const done = await checkout.confirmCheckout(opened.sessionId);
    if (done.status !== "completed") throw new Error("the free plan did not complete");
    return {
      sessionId: opened.sessionId,
      customerSlug: done.session.customerSlug!,
      instanceSlug: done.session.instanceSlug!,
      email,
    };
  };

  /** What the page posts. */
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    route(
      new Request(`${ORIGIN}${CHECKOUT_COMPLETED_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    ) as Promise<Response>;

  const calls = () => double.calls();
  return { double, client, route, buy, post, calls, fetchDouble };
}

type Shop = ReturnType<typeof shop>;
type Bought = Awaited<ReturnType<Shop["buy"]>>;

/** The calls Kaiten saw for one slug, as `METHOD path`. */
const vendorCalls = (made: Shop, bought: Bought) =>
  made
    .calls()
    .filter((call) => call.credential === "ksh_")
    .filter(
      (call) => call.path.endsWith(bought.customerSlug) || call.path.endsWith(bought.instanceSlug),
    )
    .map((call) => `${call.method} ${call.path.split("/")[1]}`);

describe("naming what a checkout made", () => {
  test("names the customer and its instance after the company, and the contact in the description", async () => {
    const made = shop();
    const bought = await made.buy();
    const response = await made.post({
      ...bought,
      company: "  Analytical Engines  ",
      name: "Ada Lovelace",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      customerName: "Analytical Engines",
      instanceName: "Analytical Engines",
      renamed: true,
    });
    expect(made.double.state()).toMatchObject({
      customers: [{ slug: bought.customerSlug, name: "Analytical Engines", createdBy: "system" }],
      instances: [
        {
          slug: bought.instanceSlug,
          name: "Analytical Engines",
          description: "Contact: Ada Lovelace",
        },
      ],
    });
    // It read both, then wrote both, with the server token and no `Origin`: a backend's calls.
    expect(vendorCalls(made, bought)).toEqual([
      "GET customers",
      "GET instances",
      "PUT customers",
      "PUT instances",
    ]);
    for (const call of made.calls().filter((each) => each.method === "PUT")) {
      expect(call).toMatchObject({ credential: "ksh_", origin: null });
    }
  });

  test("sends back what a full replacement keeps: the address, the dates, the licence, and nothing it must not", async () => {
    const made = shop();
    const bought = await made.buy();
    await made.post({ ...bought, company: "Analytical Engines", name: "Ada" });

    const [customerPut, instancePut] = made.calls().filter((call) => call.method === "PUT");
    expect(customerPut!.body).toEqual({
      name: "Analytical Engines",
      billingEmail: "ada@acme.test",
    });
    expect(Object.keys(instancePut!.body as object).sort()).toEqual([
      "customerId",
      "description",
      "endLicenseDate",
      "licenseId",
      "metadata",
      "name",
      "startLicenseDate",
    ]);
    expect(instancePut!.body).toMatchObject({ licenseId: STARTER_LICENCE });
    // The billing address is still the buyer's, whatever the customer is called now.
    expect(made.double.state().customers).toMatchObject([{ billingEmail: "ada@acme.test" }]);
  });

  test("a member Kaiten answers as null is left out of the replacement, not sent back as null", async () => {
    const made = shop();
    const bought = await made.buy();
    const read = async (path: string) =>
      (await (
        await made.fetchDouble(`${API}${path}`, {
          headers: { authorization: `Bearer ${SERVER_TOKEN}` },
        })
      ).json()) as Record<string, unknown>;
    const customer = await read(`/customers/${bought.customerSlug}`);
    const instance = await read(`/instances/${bought.instanceSlug}`);
    made.double.script(`GET /customers/${bought.customerSlug}`, {
      status: 200,
      body: { ...customer, domain: null, externalCustomerId: null, integrations: null },
    });
    made.double.script(`GET /instances/${bought.instanceSlug}`, {
      status: 200,
      body: { ...instance, deploymentZoneId: null, metadata: null, integrations: null },
    });
    const response = await made.post({ ...bought, company: "Analytical Engines" });
    expect(response.status).toBe(200);
    const [customerPut, instancePut] = made.calls().filter((call) => call.method === "PUT");
    expect(customerPut!.body).toEqual({
      name: "Analytical Engines",
      billingEmail: "ada@acme.test",
    });
    expect(Object.keys(instancePut!.body as object)).not.toContain("deploymentZoneId");
    expect(Object.keys(instancePut!.body as object)).not.toContain("metadata");
    expect(Object.keys(instancePut!.body as object)).not.toContain("integrations");
  });

  test("a company alone names both, and leaves the description as it was", async () => {
    const made = shop();
    const bought = await made.buy();
    const response = await made.post({ ...bought, company: "Analytical Engines" });
    expect(response.status).toBe(200);
    expect(made.double.state()).toMatchObject({
      customers: [{ name: "Analytical Engines" }],
      instances: [{ name: "Analytical Engines", description: "" }],
    });
  });

  test("a name alone names both after the person, who is also the contact", async () => {
    const made = shop();
    const bought = await made.buy();
    const response = await made.post({ ...bought, name: "Ada Lovelace" });
    expect(await response.json()).toMatchObject({ customerName: "Ada Lovelace" });
    expect(made.double.state()).toMatchObject({
      customers: [{ name: "Ada Lovelace" }],
      instances: [{ name: "Ada Lovelace", description: "Contact: Ada Lovelace" }],
    });
  });

  test("an address that is typed in other letters is the same address", async () => {
    const made = shop();
    const bought = await made.buy("Ada@Acme.test");
    const response = await made.post({ ...bought, email: "ada@ACME.test", company: "Engines" });
    expect(response.status).toBe(200);
    expect(made.double.state().customers).toMatchObject([{ name: "Engines" }]);
  });

  test("posted twice, it is done once: the second answers the same and writes nothing", async () => {
    const made = shop();
    const bought = await made.buy();
    const body = { ...bought, company: "Analytical Engines", name: "Ada Lovelace" };
    const first = await made.post(body);
    const writes = () => made.calls().filter((call) => call.method === "PUT").length;
    expect(writes()).toBe(2);

    const second = await made.post(body);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      customerName: "Analytical Engines",
      instanceName: "Analytical Engines",
      renamed: false,
    });
    expect(await first.clone().json()).toMatchObject({ renamed: true });
    expect(writes()).toBe(2);
  });

  test("goes on from a naming that stopped half way: the customer is named, the instance is not", async () => {
    const made = shop();
    const bought = await made.buy();
    made.double.script(`PUT /instances/${bought.instanceSlug}`, {
      status: 503,
      body: { code: "x" },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const stopped = await made.post({ ...bought, company: "Analytical Engines", name: "Ada" });
    expect(stopped.status).toBe(502);
    expect(made.double.state()).toMatchObject({
      customers: [{ name: "Analytical Engines" }],
      instances: [{ name: "ada@acme.test" }],
    });

    const again = await made.post({ ...bought, company: "Analytical Engines", name: "Ada" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ renamed: true });
    expect(made.double.state()).toMatchObject({
      customers: [{ name: "Analytical Engines" }],
      instances: [{ name: "Analytical Engines", description: "Contact: Ada" }],
    });
    // The customer was not written a second time.
    expect(
      made.calls().filter((call) => call.method === "PUT" && call.path.includes("/customers/")),
    ).toHaveLength(1);
  });
});

describe("what it will not do", () => {
  const writes = (made: Shop) => made.calls().filter((call) => call.method === "PUT");

  test("an address other than the customer's is refused, and nothing is written", async () => {
    const made = shop();
    const bought = await made.buy();
    const response = await made.post({ ...bought, email: "mallory@evil.test", company: "Evil" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "email_mismatch" });
    expect(writes(made)).toEqual([]);
    expect(made.double.state().customers).toMatchObject([{ name: "ada@acme.test" }]);
  });

  test("a customer a person or a service made is not renamed, whatever its address and slug", async () => {
    const made = shop();
    const { data: theirs } = await Customers.createCustomer({
      client: made.client,
      throwOnError: true,
      body: { name: "ada@acme.test", billingEmail: "ada@acme.test" },
    });
    const { data: instance } = await Instances.createInstance({
      client: made.client,
      throwOnError: true,
      body: {
        name: "ada@acme.test",
        description: "",
        customerId: theirs.id,
        licenseId: STARTER_LICENCE,
        startLicenseDate: "2026-10-21T10:00:00.000Z",
        endLicenseDate: "2029-10-21T10:00:00.000Z",
      },
    });
    const response = await made.post({
      sessionId: "chk_whatever",
      customerSlug: theirs.slug,
      instanceSlug: instance.slug,
      email: "ada@acme.test",
      company: "Evil",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_made_by_a_checkout" });
    expect(writes(made)).toEqual([]);
  });

  test("an instance of another customer is refused", async () => {
    const made = shop();
    const ada = await made.buy("ada@acme.test");
    const grace = await made.buy("grace@acme.test");
    const response = await made.post({
      ...ada,
      instanceSlug: grace.instanceSlug,
      company: "Analytical Engines",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "instance_of_another_customer" });
    expect(writes(made)).toEqual([]);
    expect(made.double.state().customers).toMatchObject([
      { name: "ada@acme.test" },
      { name: "grace@acme.test" },
    ]);
  });

  test("a customer already named something else is not renamed again", async () => {
    const made = shop();
    const bought = await made.buy();
    await made.post({ ...bought, company: "Analytical Engines" });
    const before = writes(made).length;

    const response = await made.post({ ...bought, company: "Another Company" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "already_named" });
    expect(writes(made)).toHaveLength(before);
    expect(made.double.state().customers).toMatchObject([{ name: "Analytical Engines" }]);
  });

  test("an instance named by someone else is not renamed, and nor is the customer after it", async () => {
    const made = shop();
    const bought = await made.buy();
    const { data: instance } = await Instances.getInstance({
      client: made.client,
      throwOnError: true,
      path: { instanceSlug: bought.instanceSlug },
    });
    await Instances.updateInstance({
      client: made.client,
      throwOnError: true,
      path: { instanceSlug: bought.instanceSlug },
      body: {
        name: "Production",
        description: "",
        customerId: instance.customerId,
        licenseId: instance.licenseId,
        startLicenseDate: instance.startLicenseDate,
        endLicenseDate: instance.endLicenseDate,
      },
    });
    const before = writes(made).length;
    const response = await made.post({ ...bought, company: "Analytical Engines" });
    expect(response.status).toBe(409);
    expect(writes(made)).toHaveLength(before);
    expect(made.double.state().customers).toMatchObject([{ name: "ada@acme.test" }]);
  });

  test("a customer or an instance Kaiten does not know is a 404", async () => {
    const made = shop();
    const bought = await made.buy();
    const unknownCustomer = await made.post({
      ...bought,
      customerSlug: "nobody-here",
      company: "X",
    });
    expect(unknownCustomer.status).toBe(404);
    expect(await unknownCustomer.json()).toEqual({ error: "not_found" });
    const unknownInstance = await made.post({
      ...bought,
      instanceSlug: "nothing-here",
      company: "X",
    });
    expect(unknownInstance.status).toBe(404);
    expect(writes(made)).toEqual([]);
  });

  test.each([
    ["a body that is not JSON", "not json", "body"],
    ["a body that is not an object", "[]", "body"],
    [
      "no session",
      { customerSlug: "ab", instanceSlug: "cd", email: "a@b.c", company: "X" },
      "sessionId",
    ],
    ["no email", { sessionId: "s", customerSlug: "ab", instanceSlug: "cd", company: "X" }, "email"],
    [
      "an email without an @",
      { sessionId: "s", customerSlug: "ab", instanceSlug: "cd", email: "ab", company: "X" },
      "email",
    ],
    [
      "a slug that is a path",
      { sessionId: "s", customerSlug: "../x", instanceSlug: "cd", email: "a@b.c", company: "X" },
      "customerSlug",
    ],
    [
      "a slug in capitals",
      { sessionId: "s", customerSlug: "ab", instanceSlug: "CD", email: "a@b.c", company: "X" },
      "instanceSlug",
    ],
    [
      "neither a company nor a name",
      {
        sessionId: "s",
        customerSlug: "ab",
        instanceSlug: "cd",
        email: "a@b.c",
        company: "  ",
        name: "",
      },
      "company",
    ],
    [
      "a company that is not text",
      { sessionId: "s", customerSlug: "ab", instanceSlug: "cd", email: "a@b.c", company: 3 },
      "company",
    ],
    [
      "a company with a line break",
      { sessionId: "s", customerSlug: "ab", instanceSlug: "cd", email: "a@b.c", company: "A\nB" },
      "company",
    ],
    [
      "a name that is too long",
      {
        sessionId: "s",
        customerSlug: "ab",
        instanceSlug: "cd",
        email: "a@b.c",
        name: "x".repeat(201),
      },
      "name",
    ],
  ])(
    "%s is a 400 that names the member, before Kaiten is asked anything",
    async (_what, body, field) => {
      const made = shop();
      const response = await made.post(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request", field });
      expect(made.calls().filter((call) => call.credential === "ksh_")).toEqual([]);
    },
  );

  test("a body that is too long is refused unread", async () => {
    const made = shop();
    const response = await made.post(JSON.stringify({ company: "x".repeat(5000) }));
    expect(response.status).toBe(413);
  });

  test("a page of another origin is refused, and so is any method but POST", async () => {
    const made = shop();
    const bought = await made.buy();
    const foreign = await made.post(
      { ...bought, company: "Evil" },
      { origin: "https://evil.test" },
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: "cross_origin" });

    const read = await made.route(new Request(`${ORIGIN}${CHECKOUT_COMPLETED_PATH}`));
    expect(read?.status).toBe(405);
    expect(read?.headers.get("allow")).toBe("POST");
    expect(writes(made)).toEqual([]);
    // Another path is not this route's.
    expect(await made.route(new Request(`${ORIGIN}/storefront-api/config`))).toBeUndefined();
  });

  test("a token Kaiten refuses is the developer's to read in the log, and the page learns nothing of it", async () => {
    const made = shop();
    const bought = await made.buy();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    made.double.script(`GET /customers/${bought.customerSlug}`, {
      status: 403,
      body: {
        title: "Forbidden",
        status: 403,
        code: "Auth.MissingScope",
        detail: "missing required scope: read:customers",
      },
    });
    const response = await made.post({ ...bought, company: "Analytical Engines" });
    expect(response.status).toBe(502);
    const said = await response.text();
    expect(JSON.parse(said)).toEqual({ error: "naming_unavailable" });
    expect(String(log.mock.calls[0]![0])).toContain("read:customers, write:customers");
    const everything = JSON.stringify([log.mock.calls, said]);
    expect(everything).not.toContain(SERVER_TOKEN);
    expect(everything).not.toContain("ksh_");
  });
});
