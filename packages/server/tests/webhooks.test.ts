import { describe, expect, test } from "vite-plus/test";
import type { KaitenWebhookEvent, KaitenWebhookType, SystemTokenIssuance } from "../src/index.ts";
import {
  isKaitenWebhookOfType,
  isWebhookVerificationError,
  KaitenWebhookVerificationError,
  verifyKaitenWebhook,
} from "../src/index.ts";

// The reference implementation's own golden vector (svix-webhooks, go/webhook_test.go
// TestWebhookSign). Kaiten does not sign its webhooks — Svix does, further down the
// outbox pipeline — so the only correct thing to implement is their format, and the
// only honest way to prove it is their vector.
const GOLDEN = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  payload: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

const AT = Number(GOLDEN.timestamp) * 1000;

/** A real Kaiten event body, signed with the golden secret. */
async function signed(body: unknown, overrides: { id?: string; timestamp?: string } = {}) {
  const payload = JSON.stringify(body);
  const id = overrides.id ?? "msg_test";
  const timestamp = overrides.timestamp ?? GOLDEN.timestamp;

  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(GOLDEN.secret.slice("whsec_".length)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);

  return {
    payload,
    headers: {
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${btoa(binary)}`,
    },
  };
}

const EVENT = { type: "com.kaiten.customer.v1.created", data: { slug: "acme" } };

describe("verifyKaitenWebhook", () => {
  test("accepts the reference implementation's golden vector", async () => {
    await expect(
      verifyKaitenWebhook({
        payload: GOLDEN.payload,
        headers: {
          "svix-id": GOLDEN.id,
          "svix-timestamp": GOLDEN.timestamp,
          "svix-signature": GOLDEN.signature,
        },
        secret: GOLDEN.secret,
        now: AT,
      }),
      // The vector's body has no `type`, so verification succeeds and the shape
      // check is what rejects it — proving the signature itself matched.
    ).rejects.toThrow(/carries no `type`/);
  });

  test("returns the typed event for a signed Kaiten payload", async () => {
    const { payload, headers } = await signed(EVENT);
    const event = await verifyKaitenWebhook({ payload, headers, secret: GOLDEN.secret, now: AT });

    expect(event.type).toBe("com.kaiten.customer.v1.created");
    expect(isKaitenWebhookOfType(event, "com.kaiten.customer.v1.created")).toBe(true);
  });

  test("accepts a Headers instance and the unbranded header names", async () => {
    const { payload, headers } = await signed(EVENT);
    const unbranded = new Headers({
      "webhook-id": headers["svix-id"],
      "webhook-timestamp": headers["svix-timestamp"],
      "webhook-signature": headers["svix-signature"],
    });

    await expect(
      verifyKaitenWebhook({ payload, headers: unbranded, secret: GOLDEN.secret, now: AT }),
    ).resolves.toMatchObject({ type: EVENT.type });
  });

  test("accepts raw bytes as well as a string", async () => {
    const { payload, headers } = await signed(EVENT);
    await expect(
      verifyKaitenWebhook({
        payload: new TextEncoder().encode(payload),
        headers,
        secret: GOLDEN.secret,
        now: AT,
      }),
    ).resolves.toMatchObject({ type: EVENT.type });
  });

  test("rejects a tampered body", async () => {
    const { headers } = await signed(EVENT);
    await expect(
      verifyKaitenWebhook({
        payload: JSON.stringify({ ...EVENT, data: { slug: "attacker" } }),
        headers,
        secret: GOLDEN.secret,
        now: AT,
      }),
    ).rejects.toBeInstanceOf(KaitenWebhookVerificationError);
  });

  test("rejects a body re-serialized by a JSON body parser", async () => {
    // The failure integrators actually hit: express.json() hands back an object,
    // and re-stringifying it changes the bytes the signature covers.
    const { payload, headers } = await signed(EVENT);
    const reserialized = JSON.stringify(JSON.parse(payload), Object.keys(EVENT).reverse());

    await expect(
      verifyKaitenWebhook({ payload: reserialized, headers, secret: GOLDEN.secret, now: AT }),
    ).rejects.toThrow(/no signature .* matched/);
  });

  test("rejects a stale timestamp, in both directions", async () => {
    const { payload, headers } = await signed(EVENT);
    for (const skew of [-400_000, 400_000]) {
      await expect(
        verifyKaitenWebhook({ payload, headers, secret: GOLDEN.secret, now: AT + skew }),
      ).rejects.toThrow(/tolerance/);
    }
  });

  test("rejects missing headers instead of trusting the body", async () => {
    const { payload } = await signed(EVENT);
    await expect(
      verifyKaitenWebhook({ payload, headers: {}, secret: GOLDEN.secret, now: AT }),
    ).rejects.toThrow(/missing signature headers/);
  });

  // Node's timingSafeEqual throws on unequal lengths, which would turn this into
  // a 500 rather than a 401 — hence the hand-written comparison.
  test.for([["v1,"], ["v1"], [""], ["v2,abc"], ["garbage"]] as const)(
    "rejects a malformed signature header (%s) without throwing anything else",
    async ([signature]) => {
      const { payload, headers } = await signed(EVENT);
      const error = await verifyKaitenWebhook({
        payload,
        headers: { ...headers, "svix-signature": signature },
        secret: GOLDEN.secret,
        now: AT,
      }).catch((caught: unknown) => caught);

      expect(isWebhookVerificationError(error)).toBe(true);
    },
  );

  test("accepts a rotated secret: several signatures in one header", async () => {
    const { payload, headers } = await signed(EVENT);
    await expect(
      verifyKaitenWebhook({
        payload,
        headers: { ...headers, "svix-signature": `v1,otherkey ${headers["svix-signature"]}` },
        secret: GOLDEN.secret,
        now: AT,
      }),
    ).resolves.toMatchObject({ type: EVENT.type });
  });
});

describe("the event union tracks the contract", () => {
  // `webhooks.ts` claims its types are derived from the generated union "so
  // regenerating from the contract propagates on its own". Nothing proved it,
  // and until the Platform API events arrived nothing had been added to the
  // contract since the sentence was written. This is that proof, pinned to the first new event.
  const SYSTEM_TOKEN_ISSUED =
    "com.kaiten.identity.v1.system_token_issued" satisfies KaitenWebhookType;

  const issuance: SystemTokenIssuance = {
    credentialKind: "platform",
    platformTokenId: "tok_platform",
    issuedTokenId: "tok_minted",
    name: "acme-automation",
    slug: "system-kaiten-9f2c1a",
    scopes: ["read:customers"],
    issuedAt: "2026-08-17T10:24:32Z",
  };

  const body = {
    name: "SYSTEM_ORGANIZATION_TOKEN_ISSUED",
    type: SYSTEM_TOKEN_ISSUED,
    data: issuance,
  } satisfies Extract<KaitenWebhookEvent, { type: typeof SYSTEM_TOKEN_ISSUED }>;

  // The `satisfies` above only bites under `vp check` — vitest goes through
  // esbuild, which erases types without checking them. So the round trip below
  // is what makes `vp test` able to say anything at all here.
  test("verifies and narrows a platform token issuance", async () => {
    const { payload, headers } = await signed(body);
    const event = await verifyKaitenWebhook({
      payload,
      headers,
      secret: GOLDEN.secret,
      now: AT,
    });

    expect(isKaitenWebhookOfType(event, SYSTEM_TOKEN_ISSUED)).toBe(true);
    if (isKaitenWebhookOfType(event, SYSTEM_TOKEN_ISSUED)) {
      expect(event.data.platformTokenId).toBe("tok_platform");
    }
  });
});
