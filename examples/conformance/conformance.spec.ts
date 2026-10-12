// The conformance suite: a customer's whole journey through a running Kaiten, with
// @kaitencloud/client and @kaitencloud/server alone, each answer held to the API
// contract. See README.md for what it needs and how to run it.
//
// Without a Kaiten to run against, it skips and says what would make it run.

import { afterAll, describe, test } from "vite-plus/test";

import { loadConfiguration } from "./src/configuration.ts";
import { Journey } from "./src/journey.ts";
import { completerFor } from "./src/setup.ts";

/** A step talks to a network, to Kaiten and to Stripe. */
const STEP_TIMEOUT_MS = 60_000;

const loaded = loadConfiguration(process.env);

if (loaded.state === "absent") {
  // Vitest hides the reason of a skipped test unless it is asked to be verbose.
  process.stderr.write(`\n${loaded.message}\n\n`);
  test("a customer's journey through Kaiten", (context) => context.skip(loaded.message));
} else if (loaded.state === "invalid") {
  test("the configuration can run the suite", () => {
    throw new Error(loaded.message);
  });
} else {
  const { configuration } = loaded;
  const journey = new Journey(configuration, {
    completeSetup: async (page) => (await completerFor(configuration.setup))(page),
  });

  describe("a customer's journey through Kaiten", () => {
    afterAll(() => journey.cleanUp());

    test(
      "the catalogue is read with a publishable key",
      () => journey.catalogue(),
      STEP_TIMEOUT_MS,
    );
    test(
      "the vendor mints a customer session, and the customer reads their portal",
      () => journey.session(),
      STEP_TIMEOUT_MS,
    );
    test("a checkout previews what is due", () => journey.dryRun(), STEP_TIMEOUT_MS);
    test(
      "a checkout without a card sends the customer to the provider's page",
      () => journey.setup(),
      STEP_TIMEOUT_MS,
    );
    test(
      "the checkout subscribes, and bills what the preview said",
      () => journey.checkout(),
      STEP_TIMEOUT_MS,
    );
    test("the invoice is listed, paid", () => journey.invoices(), STEP_TIMEOUT_MS);
    test(
      "the subscription is canceled at the end of its period",
      () => journey.cancel(),
      STEP_TIMEOUT_MS,
    );
    test("the cancellation is withdrawn", () => journey.reactivate(), STEP_TIMEOUT_MS);
    test("the session is revoked, and refused afterwards", () => journey.revoke(), STEP_TIMEOUT_MS);
  });
}
