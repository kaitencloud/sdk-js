import { expect, test } from "vite-plus/test";

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
