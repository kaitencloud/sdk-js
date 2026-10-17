// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The journey, rehearsed against a stand-in for Kaiten (tests/support/fake-kaiten.ts):
// it walks the routes in the order the suite promises, and it fails, naming what is
// wrong, when the API does not keep to the contract or to the journey. None of this
// reaches a network.

import { describe, expect, test } from "vite-plus/test";

import type { Configuration } from "../src/configuration.ts";
import { Journey } from "../src/journey.ts";
import { fakeKaiten, PUBLISHABLE_KEY, SERVER_TOKEN } from "./support/fake-kaiten.ts";
import type { Fake } from "./support/fake-kaiten.ts";

const configuration: Configuration = {
  apiUrl: "https://kaiten.test/api",
  publishableKey: PUBLISHABLE_KEY,
  serverToken: SERVER_TOKEN,
  customerSlug: "initech",
  instanceSlug: "initech-lab",
  returnUrl: "https://shop.initech.test/return",
  billingEmail: "ap@initech.test",
  setup: { kind: "stripe", secretKey: "sk_test_stand_in", apiUrl: "https://stripe.test" },
};

function rehearsal(options: Fake = {}) {
  const fake = fakeKaiten(options);
  const journey = new Journey(configuration, { fetch: fake.fetch, completeSetup: fake.saveCard });
  return { fake, journey };
}

/** Every step of the suite, in its order. */
const STEPS = [
  "catalogue",
  "session",
  "dryRun",
  "setup",
  "checkout",
  "invoices",
  "cancel",
  "reactivate",
  "revoke",
] as const;

async function walk(journey: Journey, until: (typeof STEPS)[number] = "revoke") {
  for (const step of STEPS) {
    await journey[step]();
    if (step === until) return;
  }
}

describe("the journey against a stand-in that keeps to the contract", () => {
  test("takes the routes of the suite in order, and leaves nothing to clean up", async () => {
    const { fake, journey } = rehearsal();

    await walk(journey);

    expect(fake.state.requests.map((route) => route.replace(/[0-9a-f-]{36}/, "<id>"))).toEqual([
      "GET /public/catalog",
      "POST /customer-sessions",
      "GET /public/session/portal",
      "POST /public/session/checkout",
      "POST /public/session/checkout",
      "POST /public/session/checkout",
      "GET /public/session/invoices",
      "POST /public/session/billing/cancel",
      "POST /public/session/billing/reactivate",
      "POST /customer-sessions/<id>/revoke",
      "POST /customer-sessions/<id>/revoke",
      // The refused session is asked for again once, after the client has renewed it.
      "GET /public/session/portal",
      "GET /public/session/portal",
    ]);
    expect(fake.state.cardSaved).toBe(true);
    expect(fake.state.subscribed).toBe(true);
    expect(fake.state.canceling).toBe(false);

    const before = fake.state.requests.length;
    await journey.cleanUp();
    expect(fake.state.requests).toHaveLength(before);
  });

  test("keeps the credentials on their routes", async () => {
    const { journey } = rehearsal();

    await walk(journey);

    const bearer = (path: string) =>
      journey.exchanges
        .filter((exchange) => exchange.path.startsWith(path))
        .map((exchange) => exchange.requestHeaders.authorization);
    expect(new Set(bearer("/public/session/"))).toEqual(new Set(["Bearer kst_…"]));
    expect(new Set(bearer("/customer-sessions"))).toEqual(new Set(["Bearer ksh_…"]));
    expect(
      journey.exchanges.find((exchange) => exchange.path === "/public/catalog")?.requestHeaders,
    ).toMatchObject({
      "x-kaiten-publishable-key": "pk_…",
    });
    // No exchange carries more of a credential than its prefix.
    expect(JSON.stringify(journey.exchanges)).not.toContain(SERVER_TOKEN);
    expect(JSON.stringify(journey.exchanges)).not.toContain(PUBLISHABLE_KEY);
  });
});

describe("the journey against an API that breaks the contract or the journey", () => {
  test("says which member an answer lacks", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (route === "GET /public/session/portal") delete body.capabilities;
        return body;
      },
    });
    await journey.catalogue();

    await expect(journey.session()).rejects.toThrow(
      /GET \/public\/session\/portal answering 200: the required member capabilities is missing/,
    );
  });

  test("says which value an answer gets wrong", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (route === "POST /customer-sessions") body.expiresAt = "tomorrow";
        return body;
      },
    });
    await journey.catalogue();

    await expect(journey.session()).rejects.toThrow(
      /POST \/customer-sessions answering 201.*is not a date-time/,
    );
  });

  test("never prints the session token when the answer that minted it breaks the contract", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (route === "POST /customer-sessions") body.expiresAt = body.token;
        return body;
      },
    });
    await journey.catalogue();

    const failure = await journey.session().then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure?.message).toContain("is not a date-time");
    expect(failure?.message).toContain('"kst_…"');
    expect(failure?.message).not.toContain("k".repeat(43));
  });

  test("never prints a session token of the wrong shape", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (route === "POST /customer-sessions") body.token = `kst_${"k".repeat(43)}!`;
        return body;
      },
    });
    await journey.catalogue();

    const failure = await journey.session().then(
      () => undefined,
      (error: unknown) => error as Error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).not.toContain("k".repeat(43));
  });

  test("fails when the activation invoice bills other than the preview said", async () => {
    const { journey } = rehearsal({ activationTotal: 5000 });
    await walk(journey, "setup");

    await expect(journey.checkout()).rejects.toThrow(
      /the preview's total is the activation invoice's/,
    );
  });

  test("fails when a revoked session still works", async () => {
    const { journey } = rehearsal({ revocationIgnored: true });
    await walk(journey, "reactivate");

    await expect(journey.revoke()).rejects.toThrow(/a revoked session is refused/);
  });

  test("tells a person that the instance has to be a fresh one", async () => {
    const { journey } = rehearsal({ alreadySubscribed: true });
    await journey.catalogue();

    await expect(journey.session()).rejects.toThrow(
      /initech-lab is subscribed already.*a fresh one for each run/,
    );
  });

  test("fails when the catalogue offers nothing a customer can buy alone", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (route === "GET /public/catalog") for (const plan of body.plans) plan.selfServe = false;
        return body;
      },
    });

    await expect(journey.catalogue()).rejects.toThrow(
      /the catalogue offers a plan a customer can buy alone/,
    );
  });

  test("fails when the plan the configuration names is not in the catalogue", async () => {
    const fake = fakeKaiten();
    const journey = new Journey(
      { ...configuration, planSlug: "no-such-plan" },
      { fetch: fake.fetch, completeSetup: fake.saveCard },
    );

    await expect(journey.catalogue()).rejects.toThrow(
      /the catalogue has a plan named no-such-plan/,
    );
  });

  test("fails on a checkout that does not ask for a card when it has none", async () => {
    const { journey } = rehearsal({
      tamper: (route, body) => {
        if (
          route === "POST /public/session/checkout" &&
          body.status === "requires_payment_method"
        ) {
          return {
            ...body,
            status: "preview",
            dueToday: { currency: "EUR", subtotal: 0, discountTotal: 0, total: 0, lines: [] },
          };
        }
        return body;
      },
    });
    await walk(journey, "dryRun");

    await expect(journey.setup()).rejects.toThrow(/the checkout answered preview/);
  });
});

describe("the order of the steps", () => {
  test("a step that needs another says so, rather than failing on what it lacks", async () => {
    const { journey } = rehearsal();

    await expect(journey.dryRun()).rejects.toThrow(
      /needs the step "session", which did not complete/,
    );
    await expect(journey.checkout()).rejects.toThrow(/needs the step "session"/);
  });

  test("a journey that stopped half way revokes the session it left", async () => {
    const { fake, journey } = rehearsal();
    await walk(journey, "session");
    expect(fake.state.revoked).toBe(false);

    await journey.cleanUp();

    expect(fake.state.revoked).toBe(true);
  });

  test("clean up never throws, though the revocation fails", async () => {
    const { fake, journey } = rehearsal();
    await walk(journey, "session");
    const failing = new Journey(configuration, {
      fetch: async () => {
        throw new Error("offline");
      },
      completeSetup: fake.saveCard,
    });

    await expect(failing.cleanUp()).resolves.toBeUndefined();
    await expect(journey.cleanUp()).resolves.toBeUndefined();
  });
});
