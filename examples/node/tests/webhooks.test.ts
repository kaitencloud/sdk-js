import { createHmac, randomBytes } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import { handleWebhook } from "../src/webhooks.ts";

// A throwaway secret, in the `whsec_<base64>` form the console issues.
const secret = `whsec_${randomBytes(24).toString("base64")}`;

function sign(payload: string, withSecret = secret) {
  const id = "msg_example";
  const timestamp = Math.floor(Date.now() / 1000);
  const key = Buffer.from(withSecret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return {
    "svix-id": id,
    "svix-timestamp": String(timestamp),
    "svix-signature": `v1,${signature}`,
  };
}

const payload = JSON.stringify({ type: "com.kaiten.customer.v1.created", data: { slug: "acme" } });

describe("handleWebhook", () => {
  test("accepts a correctly signed event", async () => {
    await expect(handleWebhook(payload, sign(payload), secret)).resolves.toEqual({
      status: 200,
      body: "com.kaiten.customer.v1.created",
    });
  });

  test("rejects a payload altered after it was signed", async () => {
    const headers = sign(payload);
    await expect(
      handleWebhook(payload.replace("acme", "other"), headers, secret),
    ).resolves.toMatchObject({
      status: 401,
    });
  });

  test("rejects an event signed with another secret", async () => {
    const other = `whsec_${randomBytes(24).toString("base64")}`;
    await expect(handleWebhook(payload, sign(payload, other), secret)).resolves.toMatchObject({
      status: 401,
    });
  });
});
