// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the suite makes of its environment: nothing set skips, everything set runs,
// anything in between or out of shape is an error that names the variable.

import { describe, expect, test } from "vite-plus/test";

import { loadConfiguration, VARIABLES, WHAT_TO_PROVIDE } from "../src/configuration.ts";

const COMPLETE = {
  [VARIABLES.apiUrl]: "http://localhost:8080/api",
  [VARIABLES.publishableKey]: `pk_${"p".repeat(43)}`,
  [VARIABLES.serverToken]: `ksh_${"s".repeat(32)}`,
  [VARIABLES.customerSlug]: "initech",
  [VARIABLES.instanceSlug]: "initech-lab",
  [VARIABLES.returnUrl]: "https://shop.initech.test/return",
  [VARIABLES.stripeTestKey]: "sk_test_abcdef123456",
};

describe("loading the configuration", () => {
  test("skips, and says what would make it run, when nothing is set", () => {
    const loaded = loadConfiguration({});

    expect(loaded.state).toBe("absent");
    for (const name of Object.values(VARIABLES).slice(0, 6)) {
      expect(loaded).toMatchObject({ message: expect.stringContaining(name) });
    }
    expect(WHAT_TO_PROVIDE).toHaveLength(7);
  });

  test("takes an empty value for no value: CI passes a secret it does not have as an empty string", () => {
    const loaded = loadConfiguration(
      Object.fromEntries(Object.values(VARIABLES).map((name) => [name, ""])),
    );

    expect(loaded.state).toBe("absent");
  });

  test("is ready with every variable, and reads them", () => {
    const loaded = loadConfiguration(COMPLETE);

    expect(loaded).toMatchObject({
      state: "ready",
      configuration: {
        apiUrl: "http://localhost:8080/api",
        customerSlug: "initech",
        instanceSlug: "initech-lab",
        billingEmail: "conformance@example.test",
        setup: {
          kind: "stripe",
          secretKey: "sk_test_abcdef123456",
          apiUrl: "https://api.stripe.com",
        },
      },
    });
  });

  test("fails, naming each variable that is missing, when only some are set", () => {
    const {
      [VARIABLES.serverToken]: _token,
      [VARIABLES.instanceSlug]: _slug,
      ...partial
    } = COMPLETE;

    const loaded = loadConfiguration(partial);

    expect(loaded.state).toBe("invalid");
    expect(loaded).toMatchObject({
      message: expect.stringMatching(
        new RegExp(
          `${VARIABLES.serverToken} is not set[\\s\\S]*${VARIABLES.instanceSlug} is not set`,
        ),
      ),
    });
  });

  test("fails when nothing completes the hosted setup page", () => {
    const { [VARIABLES.stripeTestKey]: _key, ...withoutStripe } = COMPLETE;

    expect(loadConfiguration(withoutStripe)).toMatchObject({
      state: "invalid",
      message: expect.stringContaining(VARIABLES.setupModule),
    });
  });

  test("accepts a module of its own in place of a Stripe key, and prefers it", () => {
    const { [VARIABLES.stripeTestKey]: _key, ...withoutStripe } = COMPLETE;

    expect(
      loadConfiguration({ ...withoutStripe, [VARIABLES.setupModule]: "./complete.mjs" }),
    ).toMatchObject({
      state: "ready",
      configuration: { setup: { kind: "module", path: "./complete.mjs" } },
    });
    expect(
      loadConfiguration({ ...COMPLETE, [VARIABLES.setupModule]: "./complete.mjs" }),
    ).toMatchObject({
      configuration: { setup: { kind: "module" } },
    });
  });

  test.each([
    ["a Stripe live key", { [VARIABLES.stripeTestKey]: "sk_live_abcdef123456" }, "test-mode key"],
    ["a Stripe key of no kind", { [VARIABLES.stripeTestKey]: "whatever" }, "test-mode key"],
    [
      "an API URL without /api",
      { [VARIABLES.apiUrl]: "http://localhost:8080" },
      "must end with /api",
    ],
    ["an API URL that is not a URL", { [VARIABLES.apiUrl]: "localhost" }, "not an http(s) URL"],
    [
      "a publishable key cut short",
      { [VARIABLES.publishableKey]: "pk_live_abc" },
      "not a publishable key",
    ],
    [
      "a secret key as the publishable one",
      { [VARIABLES.publishableKey]: `ksh_${"s".repeat(40)}` },
      "not a publishable key",
    ],
    [
      "a server token that is not one",
      { [VARIABLES.serverToken]: `pk_${"p".repeat(43)}` },
      "not a token",
    ],
    ["a return URL that is not a URL", { [VARIABLES.returnUrl]: "back" }, "not an http(s) URL"],
    [
      "a Stripe API URL that is not a URL",
      { [VARIABLES.stripeApiUrl]: "stripe" },
      "not an http(s) URL",
    ],
  ])("refuses %s", (_name, override, message) => {
    const loaded = loadConfiguration({ ...COMPLETE, ...override });

    expect(loaded).toMatchObject({ state: "invalid", message: expect.stringContaining(message) });
  });

  test("never repeats a secret in what it says", () => {
    const loaded = loadConfiguration({
      ...COMPLETE,
      [VARIABLES.stripeTestKey]: "sk_live_THE-SECRET-ITSELF",
      [VARIABLES.serverToken]: "wrong-THE-OTHER-SECRET",
    });

    expect(loaded.state).toBe("invalid");
    expect(JSON.stringify(loaded)).not.toContain("THE-SECRET-ITSELF");
    expect(JSON.stringify(loaded)).not.toContain("THE-OTHER-SECRET");
  });
});
