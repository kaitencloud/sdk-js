// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then random bits. The
 * default `transactionId` — time-ordered, so the server's rows sort the way the
 * calls happened, and well inside the contract's `^[A-Za-z0-9._:-]{1,128}$`.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let ms = Math.max(0, Math.floor(now));
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const LARGE_BLOB = /^(data:|[A-Za-z0-9+/=_-]{2048,}$)/;
/** What an inline image, audio clip or file is counted as, in tokens. */
const BLOB_TOKENS = 1024;

/**
 * The default input estimate: serialized prompt bytes / 4.
 *
 * The provider SDKs do not count tokens, and a tokenizer is a dependency this
 * package does not take: plug one in through a wrapper's `estimator` option
 * when the estimate matters. Inline blobs (data URLs, long base64 strings) are
 * counted as a flat {@link BLOB_TOKENS} each instead of by their bytes, which
 * would otherwise reserve hundreds of thousands of tokens for one image.
 */
export function estimateTokens(value: unknown): number {
  let blobs = 0;
  const text =
    typeof value === "string"
      ? value
      : (JSON.stringify(value, (_key, item: unknown) => {
          if (typeof item === "string" && item.length > 256 && LARGE_BLOB.test(item)) {
            blobs += 1;
            return "";
          }
          return item;
        }) ?? "");
  return Math.ceil(new TextEncoder().encode(text).length / 4) + blobs * BLOB_TOKENS;
}
