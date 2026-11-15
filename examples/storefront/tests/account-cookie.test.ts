// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createHmac } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import {
  ACCOUNT_COOKIE,
  ACCOUNT_LIFETIME_SECONDS,
  createAccountCookie,
} from "../server/account-cookie.ts";
import { generateSlug, slugify } from "../server/slug.ts";

const SECRET = "s".repeat(40);
const ACCOUNT = { customerSlug: "initech-1a2b3c", instanceSlug: "initech-4d5e6f" };
/** A moment the cookies of these tests are good for, as epoch seconds: well ahead of the real clock. */
const GOOD_UNTIL = Math.floor(Date.now() / 1000) + 3600;

const http = new Request("http://storefront.test/storefront-api/account");
const https = new Request("https://storefront.test/storefront-api/account");
const withCookie = (value: string) =>
  new Request("http://storefront.test/", {
    headers: { cookie: `other=1; ${ACCOUNT_COOKIE}=${value}; x=y` },
  });

/** A value as the cookie writes it, for a payload and a secret: to forge what the tests then refuse. */
const signed = (payload: unknown, secret = SECRET, version = "v1") => {
  const encoded = Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  ).toString("base64url");
  const mac = createHmac("sha256", secret).update(`${version}.${encoded}`).digest("base64url");
  return `${version}.${encoded}.${mac}`;
};

describe("the cookie that remembers who signed up", () => {
  const cookie = createAccountCookie(SECRET);

  test("holds the two slugs and nothing else, and reads them back", () => {
    const value = cookie.sign(ACCOUNT);
    expect(cookie.verify(value)).toEqual(ACCOUNT);
    expect(cookie.read(withCookie(value))).toEqual(ACCOUNT);

    const payload = JSON.parse(Buffer.from(value.split(".")[1]!, "base64url").toString("utf8"));
    // The two slugs and the moment it stops being good.
    expect(Object.keys(payload).sort()).toEqual(["c", "e", "i"]);
    expect(value).not.toContain(SECRET);
  });

  test("is httpOnly and SameSite=Lax, for 30 days, and Secure only on https", () => {
    const set = cookie.set(ACCOUNT, http);
    expect(set.startsWith(`${ACCOUNT_COOKIE}=v1.`)).toBe(true);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain(`Max-Age=${ACCOUNT_LIFETIME_SECONDS}`);
    expect(ACCOUNT_LIFETIME_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(set).not.toContain("Secure");
    expect(cookie.set(ACCOUNT, https)).toContain("; Secure");
  });

  test("is cleared with the same attributes and no value", () => {
    const cleared = cookie.clear(https);
    expect(cleared.startsWith(`${ACCOUNT_COOKIE}=;`)).toBe(true);
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Lax");
    expect(cleared).toContain("; Secure");
  });

  test("is absent for a request without it, and present, not valid, for one that is not whole", () => {
    expect(cookie.read(http)).toBeNull();
    expect(cookie.present(http)).toBe(false);
    expect(cookie.present(withCookie("junk"))).toBe(true);
    expect(cookie.read(withCookie("junk"))).toBeNull();
  });

  test.each([
    [
      "a payload that was changed",
      () => {
        const [version, , mac] = cookie.sign(ACCOUNT).split(".");
        const other = Buffer.from(
          JSON.stringify({ c: "globex-aaaaaa", i: "globex-bbbbbb" }),
        ).toString("base64url");
        return `${version}.${other}.${mac}`;
      },
    ],
    [
      "a MAC that was changed",
      () => {
        const [version, payload, mac] = cookie.sign(ACCOUNT).split(".");
        return `${version}.${payload}.${mac!.slice(0, -2)}AA`;
      },
    ],
    ["a MAC of another length", () => `${cookie.sign(ACCOUNT)}A`],
    // `Buffer.from(…, "base64url")` skips what is not base64: these decode to the right bytes, and are not the cookie.
    ["a MAC with a character that is not base64 added", () => `${cookie.sign(ACCOUNT)}!`],
    [
      "a MAC with a character that is not base64 in the middle",
      () => {
        const [version, payload, mac] = cookie.sign(ACCOUNT).split(".");
        return `${version}.${payload}.${mac!.slice(0, 10)}*${mac!.slice(10)}`;
      },
    ],
    [
      "a MAC with a space in it",
      () => {
        const [version, payload, mac] = cookie.sign(ACCOUNT).split(".");
        return `${version}.${payload}.${mac!.slice(0, 20)} ${mac!.slice(20)}`;
      },
    ],
    ["a MAC padded as base64 would be", () => `${cookie.sign(ACCOUNT)}=`],
    [
      "another secret",
      () =>
        signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: GOOD_UNTIL }, "x".repeat(40)),
    ],
    ["a missing part", () => cookie.sign(ACCOUNT).split(".").slice(0, 2).join(".")],
    ["a part too many", () => `${cookie.sign(ACCOUNT)}.extra`],
    [
      "another version",
      () =>
        signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: GOOD_UNTIL }, SECRET, "v2"),
    ],
    ["a payload that is not JSON", () => signed("not json")],
    ["a payload that is not an object", () => signed("42")],
    ["a payload that is null", () => signed("null")],
    [
      "a customer slug outside the contract's pattern",
      () => signed({ c: "-bad-", i: ACCOUNT.instanceSlug, e: GOOD_UNTIL }),
    ],
    [
      "an instance slug that is not a string",
      () => signed({ c: ACCOUNT.customerSlug, i: 7, e: GOOD_UNTIL }),
    ],
    ["a slug of one character", () => signed({ c: "a", i: ACCOUNT.instanceSlug, e: GOOD_UNTIL })],
    [
      "a slug of upper case",
      () => signed({ c: "Initech", i: ACCOUNT.instanceSlug, e: GOOD_UNTIL }),
    ],
    [
      "an expiry in the past",
      () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: 1_000_000_000 }),
    ],
    ["no expiry", () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug })],
    [
      "an expiry that is not a whole number",
      () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: GOOD_UNTIL + 0.5 }),
    ],
    [
      "an expiry that is text",
      () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: String(GOOD_UNTIL) }),
    ],
    ["nothing", () => ""],
  ])("ignores %s", (_name, forge) => {
    const value = forge();
    expect(cookie.verify(value)).toBeNull();
    expect(cookie.read(withCookie(value))).toBeNull();
  });

  test("a value signed with the right secret and a good expiry is an account (the forgeries above fail for their own reasons)", () => {
    expect(
      cookie.verify(signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug, e: GOOD_UNTIL })),
    ).toEqual(ACCOUNT);
  });

  test("expires 30 days after it was signed, in the signed value and not only in the browser", () => {
    let now = new Date("2026-10-21T10:00:00Z");
    const clocked = createAccountCookie(SECRET, () => now);
    const value = clocked.sign(ACCOUNT);

    expect(clocked.verify(value)).toEqual(ACCOUNT);
    now = new Date(now.getTime() + (ACCOUNT_LIFETIME_SECONDS - 1) * 1000);
    expect(clocked.verify(value)).toEqual(ACCOUNT);
    now = new Date(now.getTime() + 1000);
    expect(clocked.verify(value)).toBeNull();
    expect(clocked.read(withCookie(value))).toBeNull();
    // A browser that kept sending it after its Max-Age: the server does not take it.
    expect(clocked.present(withCookie(value))).toBe(true);
  });

  test("a value signed with one secret is no account for a server with another", () => {
    const other = createAccountCookie("o".repeat(40));
    expect(other.verify(cookie.sign(ACCOUNT))).toBeNull();
  });

  test("without a secret, every server signs with a key of its own", () => {
    const first = createAccountCookie();
    const second = createAccountCookie();
    expect(first.verify(first.sign(ACCOUNT))).toEqual(ACCOUNT);
    expect(second.verify(first.sign(ACCOUNT))).toBeNull();
  });
});

describe("slugs for what a sign-up creates", () => {
  const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

  test.each([
    ["Initech", "initech"],
    ["  Acme & Sons, Inc.  ", "acme-sons-inc"],
    ["Café Münster", "cafe-munster"],
    ["日本", "customer"],
    ["a", "customer"],
    ["---", "customer"],
    ["x".repeat(80), "x".repeat(40)],
    ["a".repeat(39) + " b", "a".repeat(39)],
  ])("%j becomes %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  test("a generated slug is the name's, a dash and six hexadecimal characters, and fits the contract", () => {
    for (const name of ["Initech", "日本", "x".repeat(300), "!!"]) {
      const slug = generateSlug(name);
      expect(slug).toMatch(SLUG);
      expect(slug).toMatch(/-[0-9a-f]{6}$/);
      expect(slug.length).toBeLessThanOrEqual(100);
    }
    expect(generateSlug("Initech")).not.toBe(generateSlug("Initech"));
    expect(generateSlug("Initech", () => "abcdef")).toBe("initech-abcdef");
  });
});
