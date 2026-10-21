// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { createHmac } from "node:crypto";

import { describe, expect, test } from "vite-plus/test";

import { ACCOUNT_COOKIE, createAccountCookie } from "../server/account-cookie.ts";
import { generateSlug, slugify } from "../server/slug.ts";

const SECRET = "s".repeat(40);
const ACCOUNT = { customerSlug: "initech-1a2b3c", instanceSlug: "initech-4d5e6f" };

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
    expect(Object.keys(payload).sort()).toEqual(["c", "i"]);
    expect(value).not.toContain(SECRET);
  });

  test("is httpOnly and SameSite=Lax, for 30 days, and Secure only on https", () => {
    const set = cookie.set(ACCOUNT, http);
    expect(set.startsWith(`${ACCOUNT_COOKIE}=v1.`)).toBe(true);
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(set).toContain(`Max-Age=${30 * 24 * 60 * 60}`);
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
    [
      "another secret",
      () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug }, "x".repeat(40)),
    ],
    ["a missing part", () => cookie.sign(ACCOUNT).split(".").slice(0, 2).join(".")],
    ["a part too many", () => `${cookie.sign(ACCOUNT)}.extra`],
    [
      "another version",
      () => signed({ c: ACCOUNT.customerSlug, i: ACCOUNT.instanceSlug }, SECRET, "v2"),
    ],
    ["a payload that is not JSON", () => signed("not json")],
    ["a payload that is not an object", () => signed("42")],
    ["a payload that is null", () => signed("null")],
    [
      "a customer slug outside the contract's pattern",
      () => signed({ c: "-bad-", i: ACCOUNT.instanceSlug }),
    ],
    ["an instance slug that is not a string", () => signed({ c: ACCOUNT.customerSlug, i: 7 })],
    ["a slug of one character", () => signed({ c: "a", i: ACCOUNT.instanceSlug })],
    ["a slug of upper case", () => signed({ c: "Initech", i: ACCOUNT.instanceSlug })],
    ["nothing", () => ""],
  ])("ignores %s", (_name, forge) => {
    const value = forge();
    expect(cookie.verify(value)).toBeNull();
    expect(cookie.read(withCookie(value))).toBeNull();
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
