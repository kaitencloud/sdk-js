// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The two ways the hosted setup page gets completed: through the Stripe API, with a
// test card, and through a module of the person's own.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";

import { completeThroughStripe, completerFor } from "../src/setup.ts";

const page = {
  setupUrl: "https://checkout.stripe.test/c/pay/cs_test_1",
  setupSessionId: "cs_test_1",
};

/** A Stripe that answers each request in turn, and keeps what it was asked. */
function stripe(...answers: Array<{ status?: number; body: unknown }>) {
  const asked: Array<{ method: string; url: string; authorization: string | null; body: string }> =
    [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    asked.push({
      method: init?.method ?? "GET",
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      authorization: headers.get("authorization"),
      body: init?.body instanceof URLSearchParams ? init.body.toString() : "",
    });
    const next = answers[asked.length - 1] ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  return { fetch, asked };
}

describe("completing the page through Stripe", () => {
  const complete = (fetch: ReturnType<typeof stripe>["fetch"]) =>
    completeThroughStripe({ secretKey: "sk_test_stand_in", apiUrl: "https://stripe.test" }, fetch);

  test("reads the session's SetupIntent, then confirms it with a test card", async () => {
    const { fetch, asked } = stripe(
      {
        body: {
          id: "cs_test_1",
          setup_intent: { id: "seti_1", status: "requires_payment_method" },
        },
      },
      { body: { id: "seti_1", status: "succeeded" } },
      { body: { id: "cs_test_1", status: "complete" } },
    );

    await complete(fetch)(page);

    expect(asked.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET https://stripe.test/v1/checkout/sessions/cs_test_1?expand[]=setup_intent",
      "POST https://stripe.test/v1/setup_intents/seti_1/confirm",
      "GET https://stripe.test/v1/checkout/sessions/cs_test_1",
    ]);
    expect(asked[1]!.body).toBe("payment_method=pm_card_visa");
    expect(new Set(asked.map(({ authorization }) => authorization))).toEqual(
      new Set(["Bearer sk_test_stand_in"]),
    );
  });

  test("says so, and names the way out, when the session has no SetupIntent", async () => {
    const { fetch, asked } = stripe({ body: { id: "cs_test_1", setup_intent: null } });

    await expect(complete(fetch)(page)).rejects.toThrow(
      /no SetupIntent to confirm yet.*KAITEN_CONFORMANCE_SETUP_MODULE/,
    );
    expect(asked).toHaveLength(1);
  });

  test("fails with what Stripe said, and never with the key", async () => {
    const { fetch } = stripe({
      status: 401,
      body: { error: { message: "Invalid API Key provided: sk_test_****" } },
    });

    const error = await complete(fetch)(page).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );

    expect(error?.message).toContain("Stripe answered 401 to GET /v1/checkout/sessions/cs_test_1");
    expect(error?.message).toContain("Invalid API Key");
    expect(error?.message).not.toContain("sk_test_stand_in");
  });

  test("fails when the SetupIntent does not succeed", async () => {
    const { fetch } = stripe(
      { body: { setup_intent: { id: "seti_1" } } },
      { body: { id: "seti_1", status: "requires_action" } },
    );

    await expect(complete(fetch)(page)).rejects.toThrow(
      /The SetupIntent is requires_action, not succeeded/,
    );
  });
});

describe("a confirmed SetupIntent on a session that stays open", () => {
  test("fails, naming the session's status and the module that takes the Stripe path's place", async () => {
    const { fetch } = stripe(
      { body: { setup_intent: { id: "seti_1" } } },
      { body: { id: "seti_1", status: "succeeded" } },
      { body: { id: "cs_test_1", status: "open" } },
    );

    await expect(
      completeThroughStripe(
        { secretKey: "sk_test_stand_in", apiUrl: "https://stripe.test" },
        fetch,
      )(page),
    ).rejects.toThrow(/Checkout session is open, not complete.*KAITEN_CONFORMANCE_SETUP_MODULE/s);
  });
});

describe("completing the page through a module of one's own", () => {
  const dir = mkdtempSync(join(tmpdir(), "kaiten-conformance-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("calls the default export with the page", async () => {
    const path = join(dir, "complete.mjs");
    writeFileSync(path, "export default async (page) => { globalThis.__completed = page; };\n");

    const complete = await completerFor({ kind: "module", path });
    await complete(page);

    expect((globalThis as { __completed?: unknown }).__completed).toEqual(page);
  });

  test("refuses a module that exports no function", async () => {
    const path = join(dir, "wrong.mjs");
    writeFileSync(path, "export const complete = 1;\n");

    await expect(completerFor({ kind: "module", path })).rejects.toThrow(
      /must export a function as its default export/,
    );
  });

  test("uses the Stripe API when the configuration says so", async () => {
    const complete = await completerFor({
      kind: "stripe",
      secretKey: "sk_test_x",
      apiUrl: "https://stripe.test",
    });

    expect(typeof complete).toBe("function");
  });
});
