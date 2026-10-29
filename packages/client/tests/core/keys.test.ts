// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  assertPublishableKey,
  assertPublishableKeyShape,
  isBrowserRuntime,
  isPublishableKey,
  isPublishableKeyShape,
  secretKeyPrefix,
} from "../../src/core/runtime/keys.ts";

// `SECRET_KEY_PREFIXES` is the only model this SDK has of what a credential is,
// and it is the thing that decides whether a leak is *named* or reported as a
// typo. It has drifted behind the platform twice now — `ksh_` was missing until
// a leaked token was reported as a bad key format, and `ksm_` was missing from
// the day the Platform API started issuing it. Until now nothing here tested it
// directly: the only coverage lived in `packages/client`, one package away,
// against the built `dist/`.
describe("credential prefixes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test.for([["sk_live_abc"], ["ksh_live_abc"], ["ksm_live_abc"]] as const)(
    "%s is refused as a secret, and named as one",
    ([key]) => {
      expect(() => assertPublishableKey(key)).toThrow(/secret key/i);
      // The message has to say *which* problem this is. An unknown prefix and a
      // secret one both fail, but only one of them means "rotate this now".
      expect(() => assertPublishableKey(key)).not.toThrow(/invalid publishable key format/i);
      expect(secretKeyPrefix(key)).toBe(key.slice(0, key.indexOf("_") + 1));
      expect(isPublishableKey(key)).toBe(false);
    },
  );

  test("a publishable key passes", () => {
    expect(() => assertPublishableKey("pk_live_abc")).not.toThrow();
    expect(isPublishableKey("pk_live_abc")).toBe(true);
    expect(secretKeyPrefix("pk_live_abc")).toBeNull();
  });

  test("an unknown prefix is a format error, not a leak", () => {
    // `ksx_` is deliberately close to the two `ks*_` families: matching them as
    // a `ks` class would swallow this case and start calling typos leaks.
    expect(() => assertPublishableKey("ksx_live_abc")).toThrow(/invalid publishable key format/i);
    expect(secretKeyPrefix("ksx_live_abc")).toBeNull();
  });

  test("a missing key says where to get one", () => {
    expect(() => assertPublishableKey("")).toThrow(/publishableKey is missing/i);
  });
});

// `assertPublishableKey` is frozen: 1.0 hosts pass it `pk_live_abc`, and it must
// keep saying yes. The shape of a key Kaiten issues has its own functions, so a
// caller that wants the strict reading opts into it.
describe("the shape of a publishable key", () => {
  const BODY = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe".slice(0, 43);
  const KEY = `pk_${BODY}`;

  test("pk_ and 43 base64url characters pass, in every alphabet position", () => {
    expect(BODY).toHaveLength(43);
    for (const body of [BODY, "a".repeat(43), "_".repeat(43), "-".repeat(43), "9".repeat(43)]) {
      expect(isPublishableKeyShape(`pk_${body}`)).toBe(true);
      expect(() => assertPublishableKeyShape(`pk_${body}`)).not.toThrow();
    }
  });

  test.for([
    ["a key cut short", `pk_${"a".repeat(42)}`],
    ["a key that runs on", `pk_${"a".repeat(44)}`],
    ["a test key", "pk_live_abc"],
    ["a space in it", `pk_${"a".repeat(42)} `],
    ["a leading space", ` ${KEY}`],
    ["a trailing newline", `${KEY}\n`],
    ["quotes around it", `"${KEY}"`],
    ["padding", `pk_${"a".repeat(42)}=`],
    ["a character outside base64url", `pk_${"a".repeat(42)}+`],
    ["a slash", `pk_${"a".repeat(42)}/`],
    ["an accented letter", `pk_${"a".repeat(42)}é`],
    ["capital PK_", KEY.replace("pk_", "PK_")],
    ["no prefix", BODY],
    ["the prefix alone", "pk_"],
    ["nothing", ""],
  ] as const)("%s is not the shape of a key", ([, key]) => {
    expect(isPublishableKeyShape(key)).toBe(false);
    expect(() => assertPublishableKeyShape(key)).toThrow();
  });

  test("a value that is not a string is not a key", () => {
    for (const value of [undefined, null, 3, {}, [KEY], Symbol("pk")]) {
      expect(isPublishableKeyShape(value)).toBe(false);
    }
  });

  test("the lenient guard is unchanged: any pk_ string still passes it", () => {
    for (const key of ["pk_live_abc", `pk_${"a".repeat(42)}`, `pk_${"a".repeat(44)}`, KEY]) {
      expect(() => assertPublishableKey(key)).not.toThrow();
      expect(isPublishableKey(key)).toBe(true);
    }
  });

  test("a secret is named as one, not reported as a malformed key", () => {
    for (const secret of [`sk_${BODY}`, `ksh_${BODY}`, `ksm_${BODY}`]) {
      expect(() => assertPublishableKeyShape(secret)).toThrow(/secret key/i);
      expect(() => assertPublishableKeyShape(secret)).not.toThrow(/malformed/i);
    }
  });

  test("a missing key says where to get one, a wrong prefix says what a key starts with", () => {
    expect(() => assertPublishableKeyShape("")).toThrow(/publishableKey is missing/i);
    expect(() => assertPublishableKeyShape("ksx_live_abc")).toThrow(
      /invalid publishable key format/i,
    );
  });

  test("a malformed key is described, and never echoed", () => {
    const short = `pk_${"s3cretish".repeat(3)}`;

    expect(() => assertPublishableKeyShape(short)).toThrow(/malformed publishable key.*43/i);
    expect(() => assertPublishableKeyShape(short)).not.toThrow(new RegExp(short));
  });
});

describe("isBrowserRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // This predicate is what makes the secret guard fire at all, and it was only
  // ever exercised indirectly, from another package.
  test("is false on a server", () => {
    expect(isBrowserRuntime()).toBe(false);
  });

  test("is true when a document-bearing window exists", () => {
    vi.stubGlobal("window", { document: {} });
    expect(isBrowserRuntime()).toBe(true);
  });

  test("a window without a document is not a browser", () => {
    // Some server runtimes and test harnesses define a bare `window`. Treating
    // one as a browser would refuse legitimate server-side bearer use.
    vi.stubGlobal("window", {});
    expect(isBrowserRuntime()).toBe(false);
  });
});
