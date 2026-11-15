// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The guards of check-bundle-size.mjs, tried on entries that plant what they exist to
// catch and on ones that do not: a headless bundle holds no code that draws, and an
// unstyled one, the React core, holds none of what the styled components bring. The
// budgets themselves are measured on the built packages by the script.

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
      'import "@radix-ui/react-slot"; import "@base-ui/react/radio"; import "tailwind-merge"; import "react-dom/client";',
    );

    const leaks = leaksOf(scenario, await measure(scenario));

    expect(leaks.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "@base-ui/react/radio",
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

/** A scenario of the React core: it may import React, and nothing the components bring. */
const unstyled = (code) => ({ name: "planted", code, budgetGzip: 1_000_000, unstyled: true });

describe("the guard against styled dependencies in an unstyled bundle", () => {
  test("lets React through, since the core is made of it", async () => {
    const scenario = unstyled(
      'import { createElement } from "react"; import { jsx } from "react/jsx-runtime"; console.log(createElement, jsx);',
    );

    expect(leaksOf(scenario, await measure(scenario))).toEqual([]);
  });

  test("names the styled dependencies, installed or not, instead of stopping on the build", async () => {
    const scenario = unstyled(
      'import "@radix-ui/react-slot"; import "@base-ui/react/radio-group"; import "class-variance-authority"; import "tailwind-merge"; import "react-remove-scroll";',
    );

    const leaks = leaksOf(scenario, await measure(scenario));

    expect(leaks.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "@base-ui/react/radio-group",
      "@radix-ui/react-slot",
      "class-variance-authority",
      "react-remove-scroll",
      "tailwind-merge",
    ]);
  });

  test("names a styled package that is bundled, by the package of the file", () => {
    const scenario = unstyled("");

    const leaks = leaksOf(scenario, {
      packages: [
        ["@kaitencloud/react", 80_000],
        ["swr", 9_000],
        ["tailwind-merge", 21_000],
        ["@base-ui/react", 27_000],
      ],
      imported: ["react"],
    });

    expect(leaks).toEqual(["tailwind-merge", "@base-ui/react"]);
  });
});
