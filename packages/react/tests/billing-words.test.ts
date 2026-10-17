// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The words of a customer session's billing screens are optional in the core and carried whole by
// every language pack. The English lives with the components, so what this suite holds is the packs
// against each other: one that forgot a string, or wrote an empty one, would leave a hole in the
// middle of a portal that is otherwise in its language.

import { expect, test } from "vite-plus/test";

import { de, es, fr } from "../src/locales.ts";

const packs = { fr, de, es } as const;
const SECTIONS = ["subscription", "portalBilling", "paymentMethodCard"] as const;

test.each(SECTIONS)("%s: the three packs carry the same words", (section) => {
  const keys = (pack: (typeof packs)[keyof typeof packs]) =>
    Object.keys(pack[section] ?? {}).sort();
  expect(keys(fr).length).toBeGreaterThan(5);
  expect(keys(de)).toEqual(keys(fr));
  expect(keys(es)).toEqual(keys(fr));
});

test.each(Object.entries(packs))(
  "the %s pack says every word, and none is empty",
  (_name, pack) => {
    for (const section of SECTIONS) {
      for (const [key, word] of Object.entries(pack[section] ?? {})) {
        const said =
          typeof word === "function"
            ? (word as (...args: unknown[]) => string)(
                "2026-11-01T00:00:00Z",
                "2026-12-01T00:00:00Z",
              )
            : word;
        expect(typeof said, `${section}.${key}`).toBe("string");
        expect((said as string).trim().length, `${section}.${key}`).toBeGreaterThan(0);
      }
    }
  },
);

test("a wait for a voucher check is said in seconds, then in minutes", () => {
  for (const pack of Object.values(packs)) {
    const wait = pack.portalBilling!.voucherWait;
    expect(wait(30)).toContain("30");
    expect(wait(89)).toContain("89");
    expect(wait(90)).toContain("2");
    expect(wait(90)).not.toContain("90");
    expect(wait(600)).toContain("10");
  }
});

test("one second is said in the singular, in every language", () => {
  const singular = { fr: "1 seconde.", de: "1 Sekunde ", es: "1 segundo." } as const;
  for (const [language, pack] of Object.entries(packs)) {
    const wait = pack.portalBilling!.voucherWait;
    const said = wait(1);
    expect(said, language).toContain(singular[language as keyof typeof singular] ?? "1 ");
    expect(said, language).not.toMatch(/1 (secondes|Sekunden|segundos)/);
    expect(wait(2), language).toContain("2 ");
  }
});
