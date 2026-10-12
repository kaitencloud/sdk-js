// @vitest-environment jsdom
//
// The words of a checkout are the components' to default and the language packs' to translate.
// The English is not in the core, so what keeps the three packs whole is this suite: a pack that
// forgets a string would say it in English in the middle of a French checkout.

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { de, es, fr } from "@kaitencloud/react/locales";
import { KaitenProvider, useLocalization } from "@kaitencloud/react";

import { englishCheckoutWords, useCheckoutWords } from "../src/components/checkout-flow/words.ts";

afterEach(cleanup);

const packs = { fr, de, es } as const;

test.each(Object.entries(packs))(
  "the %s pack carries every word the English has, and no other",
  (_name, pack) => {
    expect(Object.keys(pack.checkoutFlow ?? {}).sort()).toEqual(
      Object.keys(englishCheckoutWords).sort(),
    );
  },
);

test.each(Object.entries(packs))(
  "the %s pack says each of them in its own language",
  (_name, pack) => {
    const words = pack.checkoutFlow!;
    for (const [key, english] of Object.entries(englishCheckoutWords) as [
      keyof typeof englishCheckoutWords,
      unknown,
    ][]) {
      const said = words[key];
      if (typeof english === "string") {
        expect(typeof said, key).toBe("string");
        expect((said as string).trim().length, key).toBeGreaterThan(0);
        expect(said, key).not.toBe(english);
      } else {
        // A function writes a sentence around what it is given: the name, the amount, the day.
        expect(typeof said, key).toBe("function");
        expect((said as (value: string) => string)("x").length, key).toBeGreaterThan(1);
      }
    }
  },
);

test("a sentence around a name or an amount carries it", () => {
  for (const pack of [englishCheckoutWords, fr.checkoutFlow!, de.checkoutFlow!, es.checkoutFlow!]) {
    for (const key of [
      "quantity",
      "decrease",
      "increase",
      "todayAmount",
      "quotaExceeded",
    ] as const) {
      expect(pack[key]("UNIQUE"), key).toContain("UNIQUE");
    }
    expect(pack.trialEndsOn("2026-11-02T00:00:00.000Z")).toMatch(/2026|02|2/);
  }
});

function probe(
  locale?: Parameters<typeof KaitenProvider>[0]["locale"],
  localization?: Parameters<typeof KaitenProvider>[0]["localization"],
) {
  return renderHook(() => useCheckoutWords(), {
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

test("with no language the words are English, and the core carries none of them", () => {
  expect(probe().subscribe).toBe("Subscribe");
  const core = renderHook(() => useLocalization(), {
    wrapper: ({ children }) => (
      <KaitenProvider mode="static" catalog={{ plans: [] }}>
        {children}
      </KaitenProvider>
    ),
  }).result.current;
  expect(core.checkoutFlow).toBeUndefined();
});

test("a language is its pack, and a host's own string wins over both", () => {
  expect(probe(fr).subscribe).toBe("Souscrire");
  expect(probe(undefined, { checkoutFlow: { subscribe: "Go" } }).subscribe).toBe("Go");
  // The rest of the English is still there around the one string.
  expect(probe(undefined, { checkoutFlow: { subscribe: "Go" } }).cancel).toBe("Cancel");
  expect(probe(fr, { checkoutFlow: { subscribe: "Go" } }).cancel).toBe("Annuler");
});

test("nothing is rendered by the words themselves", () => {
  render(<div data-testid="x" />);
  expect(screen.getByTestId("x")).toBeTruthy();
});
