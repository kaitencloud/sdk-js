// @vitest-environment jsdom
//
// The words of a customer session's billing screens are the components' to default and the language
// packs' to translate: the English is not in the core, so what keeps the three packs whole is this
// suite. A pack that forgets a string would say it in English in the middle of a French portal.

import { renderHook } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { de, es, fr } from "@kaitencloud/react/locales";
import { KaitenProvider, useLocalization } from "@kaitencloud/react";

import {
  englishPaymentMethodWords,
  englishPortalBillingWords,
  englishSubscriptionWords,
  usePaymentMethodWords,
  usePortalBillingWords,
  useSubscriptionWords,
} from "../src/components/shared/billing-words.ts";

const packs = { fr, de, es } as const;
const sections = [
  ["subscription", englishSubscriptionWords],
  ["portalBilling", englishPortalBillingWords],
  ["paymentMethodCard", englishPaymentMethodWords],
] as const;

// Words that are the same in another language, or a name that is not translated.
const SAME_AS_ENGLISH = new Set(["pdf", "card", "kindActivation", "provenanceBase"]);

test.each(Object.entries(packs))(
  "the %s pack carries every word the English has, and no other",
  (_name, pack) => {
    for (const [section, english] of sections) {
      expect(Object.keys(pack[section] ?? {}).sort(), section).toEqual(Object.keys(english).sort());
    }
  },
);

test.each(Object.entries(packs))(
  "the %s pack says each of them in its own language",
  (_name, pack) => {
    for (const [section, english] of sections) {
      const words = pack[section] as unknown as Record<string, unknown>;
      for (const [key, said] of Object.entries(words)) {
        const base = (english as unknown as Record<string, unknown>)[key];
        if (typeof base === "string") {
          expect(typeof said, `${section}.${key}`).toBe("string");
          expect((said as string).trim().length, `${section}.${key}`).toBeGreaterThan(0);
          if (!SAME_AS_ENGLISH.has(key)) expect(said, `${section}.${key}`).not.toBe(base);
        } else {
          // A function writes a sentence around what it is given: a name, an amount, a day.
          expect(typeof said, `${section}.${key}`).toBe("function");
        }
      }
    }
  },
);

test("a sentence around a name, a date or an amount carries it", () => {
  const day = "2026-11-01T00:00:00Z";
  for (const portal of [
    englishPortalBillingWords,
    fr.portalBilling!,
    de.portalBilling!,
    es.portalBilling!,
  ]) {
    for (const key of [
      "addonQuantity",
      "addonLess",
      "addonMore",
      "addonUpTo",
      "addonRemovePrompt",
    ] as const) {
      expect(portal[key]("UNIQUE"), key).toContain("UNIQUE");
    }
    expect(portal.cancelPrompt(day)).toMatch(/2026|01|1/);
    expect(portal.invoicePeriod(day, day)).toMatch(/2026|01|1/);
    // Seconds are said as seconds, and minutes as minutes.
    expect(portal.voucherWait(30)).toContain("30");
    expect(portal.voucherWait(120)).toContain("2");
    expect(portal.voucherWait(120)).not.toContain("120");
  }
  for (const subscription of [
    englishSubscriptionWords,
    fr.subscription!,
    de.subscription!,
    es.subscription!,
  ]) {
    expect(subscription.trialEndsOn(day)).toMatch(/2026|01|1/);
    expect(subscription.endsOn(day)).toMatch(/2026|01|1/);
    expect(subscription.changesOn("€490.00/year", day)).toContain("€490.00/year");
  }
  for (const card of [
    englishPaymentMethodWords,
    fr.paymentMethodCard!,
    de.paymentMethodCard!,
    es.paymentMethodCard!,
  ]) {
    expect(card.expires("12/2030")).toContain("12/2030");
  }
});

function probe<T>(
  hook: () => T,
  locale?: Parameters<typeof KaitenProvider>[0]["locale"],
  localization?: Parameters<typeof KaitenProvider>[0]["localization"],
) {
  return renderHook(hook, {
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
  expect(probe(useSubscriptionWords).subscribe).toBe("Subscribe");
  expect(probe(usePortalBillingWords).invoices).toBe("Invoices");
  expect(probe(usePaymentMethodWords).title).toBe("Payment method");
  const core = probe(useLocalization);
  expect(core.subscription).toBeUndefined();
  expect(core.portalBilling).toBeUndefined();
  expect(core.paymentMethodCard).toBeUndefined();
});

test("a language is its pack, and a host's own string wins over both", () => {
  expect(probe(usePortalBillingWords, fr).invoices).toBe("Factures");
  expect(probe(usePaymentMethodWords, de).add).toBe("Zahlungsmethode hinzufügen");
  expect(probe(useSubscriptionWords, es).subscribe).toBe("Suscribirse");
  expect(
    probe(usePortalBillingWords, undefined, { portalBilling: { invoices: "Bills" } }).invoices,
  ).toBe("Bills");
  // The rest of the English is still there around the one string.
  expect(
    probe(usePortalBillingWords, undefined, { portalBilling: { invoices: "Bills" } }).pay,
  ).toBe("Pay");
  expect(probe(usePortalBillingWords, fr, { portalBilling: { invoices: "Bills" } }).pay).toBe(
    "Payer",
  );
});
