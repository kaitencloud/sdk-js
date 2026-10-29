// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The cookie that remembers who signed up. This storefront has no passwords: a visitor who signed
// up on this browser is the customer and the instance the cookie names, and nothing else. So the
// cookie holds those two slugs and the moment it stops being good (no name, no e-mail, no Kaiten
// id), and it is signed: the server keeps a secret, and a cookie it did not sign, one that was
// altered, or one that has expired, is ignored as if it were absent.
//
// There is no server-side store, so there is nothing to revoke: a sign-out clears the browser's copy
// and ends the sessions this process minted, but a copy of the cookie made before stays good until
// it expires, or until the secret changes. A real site keeps its sessions server-side.
//
// A real site has its own authentication and maps its user to a customer and an instance; this is
// the smallest honest stand-in for that mapping.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** The cookie's name. */
export const ACCOUNT_COOKIE = "storefront_account";

/** The shortest secret `STOREFRONT_COOKIE_SECRET` can be. */
export const MIN_SECRET_LENGTH = 32;

/** How long an account is good for after sign-up: 30 days, in the browser (`Max-Age`) and in the signed value. */
export const ACCOUNT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** The account a visitor signed up: the slugs Kaiten knows it by. */
export interface Account {
  customerSlug: string;
  instanceSlug: string;
}

/** The contract's pattern for a slug (`Customer.slug`, `Instance.slug`). */
const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const isSlug = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 2 && value.length <= 100 && SLUG.test(value);

const VERSION = "v1";

/** What a MAC looks like once written: 32 bytes in unpadded base64url. Nothing else is decoded. */
const MAC_TEXT = /^[A-Za-z0-9_-]{43}$/;

export interface AccountCookie {
  /** The cookie's value for an account. */
  sign: (account: Account) => string;
  /** The account a value holds, or `null` for anything this server did not sign, altered or not whole. */
  verify: (value: string) => Account | null;
  /** The account the request's cookie holds: `null` without a cookie, and for one that fails `verify`. */
  read: (request: Request) => Account | null;
  /** Whether the request carries a cookie of this name at all, valid or not. */
  present: (request: Request) => boolean;
  /** The `Set-Cookie` that remembers an account. */
  set: (account: Account, request: Request) => string;
  /** The `Set-Cookie` that forgets it. */
  clear: (request: Request) => string;
}

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64url");

/**
 * The cookie for a secret. Without one, a random secret made now: every account is forgotten when
 * the process stops, which is what a demo wants and a deployment does not.
 */
export function createAccountCookie(
  secret: string = randomBytes(32).toString("base64url"),
  /** The clock, for when a value expires. */
  now: () => Date = () => new Date(),
): AccountCookie {
  const seconds = () => Math.floor(now().getTime() / 1000);
  const mac = (payload: string) =>
    createHmac("sha256", secret).update(`${VERSION}.${payload}`).digest();

  const verify = (value: string): Account | null => {
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== VERSION) return null;
    const [, payload, given] = parts as [string, string, string];

    // `Buffer.from(…, "base64url")` skips what is not base64, so a MAC with junk in it would decode to
    // the right bytes: only the canonical text is decoded.
    if (!MAC_TEXT.test(given)) return null;
    const expected = mac(payload);
    const received = Buffer.from(given, "base64url");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

    try {
      const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (typeof decoded !== "object" || decoded === null) return null;
      const { c, i, e } = decoded as { c?: unknown; i?: unknown; e?: unknown };
      if (typeof e !== "number" || !Number.isInteger(e) || e <= seconds()) return null;
      return isSlug(c) && isSlug(i) ? { customerSlug: c, instanceSlug: i } : null;
    } catch {
      return null;
    }
  };

  const sign = (account: Account): string => {
    const payload = encode(
      JSON.stringify({
        c: account.customerSlug,
        i: account.instanceSlug,
        e: seconds() + ACCOUNT_LIFETIME_SECONDS,
      }),
    );
    return `${VERSION}.${payload}.${mac(payload).toString("base64url")}`;
  };

  const raw = (request: Request): string | null => {
    const header = request.headers.get("cookie");
    if (!header) return null;
    for (const part of header.split(";")) {
      const at = part.indexOf("=");
      if (at > 0 && part.slice(0, at).trim() === ACCOUNT_COOKIE) return part.slice(at + 1).trim();
    }
    return null;
  };

  /** `Secure` goes with https: a cookie that is not meant for a plain connection must not travel on one. */
  const attributes = (request: Request, maxAge: number) =>
    [
      "HttpOnly",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${maxAge}`,
      ...(new URL(request.url).protocol === "https:" ? ["Secure"] : []),
    ].join("; ");

  return {
    sign,
    verify,
    read: (request) => {
      const value = raw(request);
      return value === null ? null : verify(value);
    },
    present: (request) => raw(request) !== null,
    set: (account, request) =>
      `${ACCOUNT_COOKIE}=${sign(account)}; ${attributes(request, ACCOUNT_LIFETIME_SECONDS)}`,
    clear: (request) => `${ACCOUNT_COOKIE}=; ${attributes(request, 0)}`,
  };
}
