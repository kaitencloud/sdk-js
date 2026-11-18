// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The portals the stories of `LicenseUsage` read are built from the one Kaiten recorded, and a story
// that drew an answer the API could not send would prove nothing about what a customer sees. Each is
// held to the response schema of `GET /public/session/portal` in `contracts/openapi.yaml`, as the
// recorded fixtures are (`packages/client/tests/fixtures-contract.test.ts`).

import { resolve } from "node:path";

import { expect, test } from "vite-plus/test";

import {
  apiCallsUsed,
  kaitenLicense,
  pastTheGrant,
  quota,
  seatsUnmeasured,
} from "../.storybook/license-portals.ts";
import { trialPortal } from "../.storybook/session-server.ts";

// Keep this test-only helper outside tsgo's declaration graph: a static cross-package import
// makes the pack emit contract-schema.d.ts beside the client's source.
const contractHelper = resolve(
  import.meta.dirname,
  "../../client/tests/support/contract-schema.ts",
);
const { responseProblems } = (await import(contractHelper)) as {
  responseProblems: (method: string, path: string, status: number, body: unknown) => string[];
};

const problemsOf = (portal: unknown) =>
  responseProblems("GET", "/public/session/portal", 200, portal);

test.each([
  ["a Kaiten licence: every quota unlimited, with what is used", kaitenLicense()],
  ["the API calls near their ceiling", apiCallsUsed(192_000)],
  ["the API calls inside their allowance", apiCallsUsed(210_000)],
  ["three quotas past their grant", pastTheGrant()],
  ["seats the server could not measure", seatsUnmeasured()],
  ["a trial", trialPortal()],
])("%s is a portal the API could send", (_name, portal) => {
  expect(problemsOf(portal)).toEqual([]);
});

test("the check is live: a number with a member the contract does not declare is refused", () => {
  const portal = kaitenLicense();
  portal.entitlements[0] = { ...quota("customers", "Customers", -1, 187), unitPlural: "customers" };
  expect(problemsOf(portal)).not.toEqual([]);
});
