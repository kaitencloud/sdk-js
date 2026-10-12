// The guard of check-bundle-size.mjs that keeps a headless bundle free of code that
// draws, tried on entries that plant what it exists to catch and on one that does
// not. The budgets themselves are measured on the built package by the script.

import { describe, expect, test } from "vite-plus/test";

import { leaksOf, measure } from "../check-bundle-size.mjs";

/** A scenario built from a host file, as the script's own are. */
const headless = (code) => ({ name: "planted", code, budgetGzip: 1_000_000, headless: true });

describe("the guard against code that draws in a headless bundle", () => {
  test("passes an entry that imports nothing that draws", async () => {
    const scenario = headless('export const answer = 42; console.log("no ui here");');

    expect(leaksOf(scenario, await measure(scenario))).toEqual([]);
  });

  test("names React when the entry imports it", async () => {
    const scenario = headless('import { createElement } from "react"; console.log(createElement);');

    expect(leaksOf(scenario, await measure(scenario))).toEqual(["react"]);
  });

  test("names a UI package that is not installed, instead of stopping on the build", async () => {
    const scenario = headless(
      'import "@radix-ui/react-slot"; import "tailwind-merge"; import "react-dom/client";',
    );

    const leaks = leaksOf(scenario, await measure(scenario));

    expect(leaks.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "@radix-ui/react-slot",
      "react-dom/client",
      "tailwind-merge",
    ]);
  });

  test("names a UI-only package that is bundled, by the package of the file", () => {
    const scenario = headless("");

    const leaks = leaksOf(scenario, {
      packages: [
        ["@kaitencloud/client", 40_000],
        ["class-variance-authority", 900],
        ["aria-hidden", 300],
      ],
      imported: [],
    });

    expect(leaks).toEqual(["class-variance-authority", "aria-hidden"]);
  });

  test("does not look at a scenario that is not headless", () => {
    const scenario = { ...headless(""), headless: false };

    expect(leaksOf(scenario, { packages: [["react", 1]], imported: ["react"] })).toEqual([]);
  });
});
