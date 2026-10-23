// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom
//
// The words of an anonymous checkout are the components' to default and the language packs' to
// translate. The English is not in the core, so what keeps the three packs whole is this suite: a
// pack that forgets a string would say it in English in the middle of a French checkout.

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { de, es, fr } from "@kaitencloud/react/locales";
import { KaitenProvider } from "@kaitencloud/react";

import {
  englishAnonymousCheckoutWords,
  useAnonymousCheckoutWords,
} from "../src/components/anonymous-checkout/words.ts";

afterEach(cleanup);

const packs = { fr, de, es } as const;
/** Words a language writes as English does. */
const SAME_AS_ENGLISH: Record<string, string[]> = { de: ["nameLabel"] };

test.each(Object.entries(packs))(
  "the %s pack carries every word the English has, and no other",
  (_name, pack) => {
    expect(Object.keys(pack.anonymousCheckout ?? {}).sort()).toEqual(
      Object.keys(englishAnonymousCheckoutWords).sort(),
    );
  },
);

test.each(Object.entries(packs))(
  "the %s pack says each of them in its own language",
  (name, pack) => {
    const words = pack.anonymousCheckout!;
    for (const [key, english] of Object.entries(englishAnonymousCheckoutWords) as [
      keyof typeof englishAnonymousCheckoutWords,
      unknown,
    ][]) {
      const said = words[key];
      if (typeof english === "string") {
        expect(typeof said, key).toBe("string");
        expect((said as string).trim().length, key).toBeGreaterThan(0);
        if (!SAME_AS_ENGLISH[name]?.includes(key)) expect(said, key).not.toBe(english);
      } else {
        expect(typeof said, key).toBe("function");
      }
    }
  },
);

test("a sentence around a name, an address or an amount carries it, in every language", () => {
  for (const pack of [
    englishAnonymousCheckoutWords,
    fr.anonymousCheckout!,
    de.anonymousCheckout!,
    es.anonymousCheckout!,
  ]) {
    expect(pack.reviewFor("UNIQUE")).toContain("UNIQUE");
    expect(pack.completedFor("UNIQUE")).toContain("UNIQUE");
    const then = pack.thenPrice("PRICE", "2026-11-04T00:00:00Z");
    expect(then).toContain("PRICE");
    expect(then).toContain("2026");
    const renews = pack.renewsAt("PRICE", "2026-11-04T00:00:00Z");
    expect(renews).toContain("PRICE");
    expect(renews).toContain("2026");
    const changed = pack.amountChanged("WAS", "NOW");
    expect(changed).toContain("WAS");
    expect(changed).toContain("NOW");
  }
});

test("a wait is said in seconds, then in minutes, and under two seconds it is a moment", () => {
  for (const [name, pack] of [
    ["en", englishAnonymousCheckoutWords],
    ["fr", fr.anonymousCheckout!],
    ["de", de.anonymousCheckout!],
    ["es", es.anonymousCheckout!],
  ] as const) {
    expect(pack.tryAgainIn(30), name).toContain("30");
    expect(pack.tryAgainIn(89), name).toContain("89");
    expect(pack.tryAgainIn(90), name).toContain("2");
    expect(pack.tryAgainIn(90), name).not.toContain("90");
    expect(pack.tryAgainIn(600), name).toContain("10");
    expect(pack.tryAgainIn(2), name).toMatch(/2 (seconds|secondes|Sekunden|segundos)/);
    // A `Retry-After: 0` is no "0 seconds".
    for (const seconds of [0, 1]) expect(pack.tryAgainIn(seconds), name).not.toMatch(/\d/);
  }
});

test("the default words promise no e-mail from Kaiten, which sends none to a vendor's buyers", () => {
  for (const [name, pack] of [
    ["en", englishAnonymousCheckoutWords],
    ["fr", fr.anonymousCheckout!],
    ["de", de.anonymousCheckout!],
    ["es", es.anonymousCheckout!],
  ] as const) {
    for (const said of [pack.emailHint, pack.completedFor("a@b.c"), pack.lostAdvice]) {
      expect(said, name).not.toMatch(/e-?mail|correo|courriel/i);
    }
  }
});

function probe(
  locale?: Parameters<typeof KaitenProvider>[0]["locale"],
  localization?: Parameters<typeof KaitenProvider>[0]["localization"],
) {
  return renderHook(() => useAnonymousCheckoutWords(), {
    wrapper: ({ children }) => (
      <KaitenProvider
        mode="static"
        catalog={{ plans: [] }}
        locale={locale}
        localization={localization}
      >
        {children}
      </KaitenProvider>
    ),
  }).result.current;
}

test("a host with no language says the English words", () => {
  expect(probe()).toEqual(englishAnonymousCheckoutWords);
});

test("a language says its own, and the host's own word wins over both", () => {
  expect(probe(fr).humanCheck).toBe(fr.anonymousCheckout!.humanCheck);
  const words = probe(fr, { anonymousCheckout: { startFree: "Gratuit pour moi" } });
  expect(words.startFree).toBe("Gratuit pour moi");
  expect(words.continue).toBe(fr.anonymousCheckout!.continue);
});

test("a host that overrides one word of a language that has none still has the English around it", () => {
  const words = probe(undefined, { anonymousCheckout: { continue: "Go" } });
  expect(words.continue).toBe("Go");
  expect(words.startFree).toBe(englishAnonymousCheckoutWords.startFree);
});
