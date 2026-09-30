import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import {
  assertPublishableKey,
  isBrowserRuntime,
  isPublishableKey,
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
