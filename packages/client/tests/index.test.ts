// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { expect, expectTypeOf, test } from "vite-plus/test";

import { client, KaitenApi, KaitenError, KaitenNetworkError, retry } from "../src/index.ts";

test("exports the generated hey-api client and namespaces SDK operations under KaitenApi", () => {
  expect(client).toBeDefined();
  expect(typeof client.setConfig).toBe("function");
  // Generated operations live under the `KaitenApi` namespace, not the top level.
  expect(typeof KaitenApi.listCustomers).toBe("function");
});

test("KaitenError exposes status and title", () => {
  const err = new KaitenError({
    title: "Not Found",
    status: 404,
    detail: "Customer not found",
  });
  expect(err.status).toBe(404);
  expect(err.message).toBe("Not Found");
  expect(err.detail).toBe("Customer not found");
});

test("KaitenNetworkError wraps the original cause", () => {
  const cause = new Error("ECONNRESET");
  const err = new KaitenNetworkError("Network unreachable", cause);
  expect(err.message).toBe("Network unreachable");
  expect(err.cause).toBe(cause);
});

test("retry resolves on success without invoking shouldRetry", async () => {
  const result = await retry(() => "ok");
  expect(result).toBe("ok");
});

test("KaitenApi keeps the names the webhook payloads had in 1.1.0, as the delivered types", () => {
  expectTypeOf<KaitenApi.SystemTokenIssuance>().toEqualTypeOf<KaitenApi.SystemTokenIssuanceDelivered>();
  expectTypeOf<KaitenApi.Deployment>().toEqualTypeOf<KaitenApi.DeploymentDelivered>();
  expectTypeOf<KaitenApi.InstanceEntitlementValueGet>().toEqualTypeOf<KaitenApi.InstanceEntitlementValueGetDelivered>();
  expectTypeOf<KaitenApi.InstanceEntitlementValueGetWritable>().toEqualTypeOf<KaitenApi.InstanceEntitlementValueGetDeliveredWritable>();

  // The delivered type only adds optional members to the old one.
  const issued: KaitenApi.SystemTokenIssuance = {
    credentialKind: "platform",
    platformTokenId: "tok_platform",
    issuedTokenId: "tok_minted",
    name: "acme-automation",
    slug: "system-kaiten-9f2c1a",
    scopes: ["read:customers"],
    issuedAt: "2026-08-17T10:24:32Z",
  };
  expect(issued.via).toBeUndefined();
});
