// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { LocalizationProvider, useLocalization } from "../src/localization/context.tsx";
import * as locales from "../src/locales.ts";

afterEach(() => cleanup());

function Probe() {
  const l = useLocalization();
  return (
    <div>
      <span data-testid="cta">{l.pricingTable.choosePlan}</span>
      <span data-testid="money">{l.formatMoney(7900, "EUR")}</span>
      <span data-testid="upgrade">{l.paywall.upgrade}</span>
    </div>
  );
}

test("locale={fr} renders French strings and fr-FR money", () => {
  render(
    <LocalizationProvider locale={locales.fr}>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("cta").textContent).toBe("Choisir cette offre");
  // fr-FR formats EUR as "79,00 €" (comma decimal, trailing symbol).
  expect(screen.getByTestId("money").textContent).toMatch(/79,00\s?€/);
});

test("explicit localization overrides the locale pack, one string at a time", () => {
  render(
    <LocalizationProvider
      locale={locales.fr}
      localization={{ paywall: { upgrade: "Monter en gamme" } }}
    >
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("upgrade").textContent).toBe("Monter en gamme");
  // Other fr strings still apply — the merge is deep, so a section override
  // does not fall back to English for the keys it left out.
  expect(screen.getByTestId("cta").textContent).toBe("Choisir cette offre");
});

test("default (no locale) stays English", () => {
  render(
    <LocalizationProvider>
      <Probe />
    </LocalizationProvider>,
  );
  expect(screen.getByTestId("cta").textContent).toBe("Choose plan");
});

test("the locales entry exports one complete pack per language, and nothing else", () => {
  // `en` is the default pack, exported so a host can name it explicitly.
  expect(Object.keys(locales).sort()).toEqual(["de", "en", "es", "fr"]);
  for (const code of ["en", "fr", "es", "de"] as const) {
    const pack = locales[code];
    expect(pack.pricingTable.choosePlan).toBeTruthy();
    expect(pack.paywall.upgrade).toBeTruthy();
    expect(typeof pack.formatMoney).toBe("function");
    expect(typeof pack.currentPlan.renewsOn).toBe("function");
  }
});

// A missing key is caught by the compiler — each pack is declared as a complete
// `KaitenLocalization`. What the compiler cannot catch is a pack that formats its
// bounds in the wrong zone, or forgets to format them at all and interpolates the
// raw ISO string.
test("every pack renders window bounds in UTC, not raw ISO", () => {
  for (const code of ["fr", "es", "de"] as const) {
    const pack = locales[code];
    const rendered = pack.usageMeters.currentWindow("2026-03-01T00:00:00Z", "2026-04-01T00:00:00Z");

    expect(rendered).toMatch(/UTC/);
    expect(rendered).not.toMatch(/2026-03-01T00:00:00Z/);
    expect(pack.usageMeters.lifetime).toBeTruthy();
  }
});

// The states a quota can be in are said by five words and three sentences. The compiler
// guarantees the keys exist; this checks that each pack says them in its own language, names the
// quota in the sentences, and keeps the four labels distinct from one another.
test("every pack names the quota in the sentences about its usage, and tells the four states apart", () => {
  for (const code of ["en", "fr", "es", "de"] as const) {
    const pack = locales[code];
    const { billingSummary, includedFeatures } = pack;

    for (const sentence of [
      billingSummary.quotaInAllowance("UNIQUE"),
      billingSummary.quotaAtLimit("UNIQUE"),
      billingSummary.quotaOverLimit("UNIQUE"),
    ]) {
      expect(sentence, code).toContain("UNIQUE");
    }
    expect(
      new Set([
        billingSummary.quotaInAllowance("X"),
        billingSummary.quotaAtLimit("X"),
        billingSummary.quotaOverLimit("X"),
        billingSummary.quotaWarning("X", 80),
      ]).size,
      code,
    ).toBe(4);

    const labels = [
      includedFeatures.nearLimit,
      includedFeatures.inAllowance,
      includedFeatures.atLimit,
      includedFeatures.overLimit,
    ];
    expect(new Set(labels).size, code).toBe(4);
    for (const label of labels) expect(label.trim().length, code).toBeGreaterThan(0);
  }
  // The console's own words, in the languages it speaks.
  expect(locales.fr.includedFeatures.inAllowance).toBe("Dépassement toléré");
  expect(locales.fr.includedFeatures.atLimit).toBe("Limite atteinte");
  expect(locales.fr.includedFeatures.overLimit).toBe("Au-delà de la limite");
  expect(locales.en.includedFeatures.inAllowance).toBe("In allowance");
  expect(locales.en.includedFeatures.atLimit).toBe("Limit reached");
});
