// Webhook signature verification.
//
// The contract declares 49 `com.kaiten.*` events and this package already ships
// a typed payload for each one — but nothing to establish that a request
// carrying such a payload actually came from Kaiten. Every handler written
// against these types was therefore an unauthenticated endpoint driving licences
// and usage.
//
// **Kaiten does not sign its webhooks; Svix does.** The API writes to an outbox,
// and delivery happens further down the pipeline through Svix. So there is no
// in-house scheme to invent here: this implements the Svix / Standard Webhooks
// format, checked against the reference implementation's own golden vector (see
// the test file).
//
// Note the contract itself documents none of this — `openapi.yaml` declares the
// 49 webhooks and not one signature header — so the header names and algorithm
// below are a convention this package pins rather than one the spec carries.

import { KaitenError } from "./errors.ts";
import type { Webhooks } from "./generated/types.gen.ts";

/**
 * A verified webhook payload: the union of the 49 `On*WebhookPayload` types.
 *
 * Derived from the generated `Webhooks` union rather than listed, so
 * regenerating from the contract propagates on its own. `Webhooks` itself is the
 * union of request *envelopes* (`{ body, key, … }`); the runtime value handlers
 * receive is the body.
 */
export type KaitenWebhookEvent = Webhooks["body"];

/** Every `com.kaiten.*` event name, as a union of string literals. */
export type KaitenWebhookType = KaitenWebhookEvent["type"];

export interface VerifyWebhookInput {
  /**
   * The **raw** request body, exactly as received.
   *
   * This is the one thing that is easy to get wrong and hard to diagnose. The
   * signature covers the bytes on the wire, so a body that has been parsed and
   * re-serialized — which is what `express.json()` hands you — will not verify
   * even when it is genuine: key order, whitespace and Unicode escaping all
   * change the bytes. Capture the raw body (`express.raw({ type: "application/json" })`,
   * `await request.text()`, a `verify` hook) and pass that.
   */
  payload: string | Uint8Array;
  /** The request headers. A `Headers` instance or a plain object. */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The endpoint's signing secret, as issued (`whsec_…`). */
  secret: string;
  /**
   * How far the timestamp may be from now, in seconds. Defaults to 300 (5
   * minutes), matching Svix, and applies in both directions — a timestamp far in
   * the future is as suspect as one far in the past.
   */
  toleranceSeconds?: number;
  /** Current time, for tests. Defaults to `Date.now()`. */
  now?: number;
}

/** Thrown when a webhook cannot be attributed to Kaiten. */
export class KaitenWebhookVerificationError extends Error {
  public readonly kind = "webhook-verification" as const;

  constructor(message: string) {
    super(message);
    this.name = "KaitenWebhookVerificationError";
  }
}

const DEFAULT_TOLERANCE_SECONDS = 300;

function readHeader(
  headers: VerifyWebhookInput["headers"],
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value =
      headers instanceof Headers
        ? headers.get(name)
        : (headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
    const resolved = Array.isArray(value) ? value[0] : value;
    if (typeof resolved === "string" && resolved.length > 0) return resolved;
  }
  return undefined;
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  // Backed by a plain ArrayBuffer rather than the ArrayBufferLike a bare
  // `new Uint8Array(n)` infers, which SubtleCrypto's BufferSource rejects.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Compares two strings without leaking where they first differ.
 *
 * Hand-written rather than `node:crypto.timingSafeEqual` for two reasons: that
 * function **throws** on unequal lengths (unlike the `hmac.Equal` the reference
 * implementation uses), so a signature of the wrong length would surface as an
 * unhandled RangeError — a 500 where a 401 belongs; and importing `node:crypto`
 * would make this package Node-only, where today it touches nothing outside the
 * web platform and runs unchanged on Deno, Bun and edge runtimes.
 */
function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a Kaiten webhook and returns its typed payload.
 *
 * Throws {@link KaitenWebhookVerificationError} when the request cannot be
 * attributed to Kaiten — respond `400`/`401` and do not process the body.
 *
 * ```ts
 * app.post("/kaiten", express.raw({ type: "application/json" }), async (req, res) => {
 *   let event;
 *   try {
 *     event = await verifyKaitenWebhook({
 *       payload: req.body,               // the RAW bytes, not a parsed object
 *       headers: req.headers,
 *       secret: process.env.KAITEN_WEBHOOK_SECRET!,
 *     });
 *   } catch {
 *     return res.sendStatus(401);
 *   }
 *
 *   switch (event.type) {
 *     case "com.kaiten.customer.v1.created":
 *       // `event` is narrowed to the customer-created payload here.
 *       break;
 *   }
 *   res.sendStatus(204);
 * });
 * ```
 */
export async function verifyKaitenWebhook(input: VerifyWebhookInput): Promise<KaitenWebhookEvent> {
  const { headers, secret, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = input;

  // Per-header fallback to the unbranded names, matching the reference
  // JavaScript implementation. (The Go one falls back all-or-nothing; the
  // permissive form cannot reject anything the strict one would accept.)
  const id = readHeader(headers, "svix-id", "webhook-id");
  const timestamp = readHeader(headers, "svix-timestamp", "webhook-timestamp");
  const signatureHeader = readHeader(headers, "svix-signature", "webhook-signature");

  if (!id || !timestamp || !signatureHeader) {
    throw new KaitenWebhookVerificationError(
      "Kaiten webhook: missing signature headers (svix-id, svix-timestamp, svix-signature).",
    );
  }

  const sentAt = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(sentAt)) {
    throw new KaitenWebhookVerificationError("Kaiten webhook: timestamp is not a number.");
  }

  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  const drift = Math.abs(nowSeconds - sentAt);
  if (drift > toleranceSeconds) {
    throw new KaitenWebhookVerificationError(
      `Kaiten webhook: timestamp is ${drift}s away from now, outside the ${toleranceSeconds}s tolerance.`,
    );
  }

  if (!secret) {
    throw new KaitenWebhookVerificationError("Kaiten webhook: no signing secret supplied.");
  }

  const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const payload =
    typeof input.payload === "string" ? input.payload : new TextDecoder().decode(input.payload);

  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${payload}`),
  );
  const expected = bytesToBase64(new Uint8Array(digest));

  // The header carries a space-separated list of `version,signature` pairs, so a
  // secret can be rotated without dropping deliveries. Only `v1` is understood;
  // anything shorter than two parts is skipped rather than treated as a match.
  const matched = signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    return constantTimeEquals(signature, expected);
  });

  if (!matched) {
    throw new KaitenWebhookVerificationError(
      "Kaiten webhook: no signature in the request matched the payload.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new KaitenWebhookVerificationError(
      "Kaiten webhook: signature is valid but the body is not JSON.",
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new KaitenWebhookVerificationError(
      "Kaiten webhook: signature is valid but the body carries no `type`.",
    );
  }

  return parsed as KaitenWebhookEvent;
}

/** Narrows a verified event to one `com.kaiten.*` type. */
export function isKaitenWebhookOfType<T extends KaitenWebhookType>(
  event: KaitenWebhookEvent,
  type: T,
): event is Extract<KaitenWebhookEvent, { type: T }> {
  return event.type === type;
}

/** True when the value is a verification failure, for a typed `catch`. */
export function isWebhookVerificationError(
  error: unknown,
): error is KaitenWebhookVerificationError {
  return error instanceof KaitenWebhookVerificationError;
}

// Re-exported so a handler can narrow API failures and verification failures in
// the same place. Not folded into `KaitenThrownError`: that union is documented
// as "every error this package throws" for the API surface, and widening it
// would break an exhaustive `switch (error.kind)` in a consumer.
export { KaitenError };
