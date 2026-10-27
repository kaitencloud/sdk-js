// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vite-plus/test";

import { workspaceCatalog } from "../lib/workspace-catalog.mjs";

describe("workspace catalog keys", () => {
  test.each([
    "typescript",
    "@playwright/test",
    "package.name",
    "package\\name",
    "package.*+?^$()[]{}|/name",
    "package\\d",
  ])("reads %s literally in both catalogs", (key) => {
    const reader = workspaceCatalog(
      `catalog:\n  "${key}": '7.0.0'\ncatalogs:\n  codegen:\n    "${key}": "6.0.0"\n`,
    );
    expect(reader.catalogEntry(key)).toBe("7.0.0");
    expect(reader.namedCatalogEntry("codegen", key)).toBe("6.0.0");
  });

  test.each(["package\\d", "package.*", "package(name)", "package|other"])(
    "does not match a different key through the metacharacters of %s",
    (key) => {
      const reader = workspaceCatalog(
        "catalog:\n  package9: 7.0.0\n  packagename: 7.0.0\n  other: 7.0.0\n" +
          "catalogs:\n  codegen:\n    package9: 6.0.0\n    packagename: 6.0.0\n    other: 6.0.0\n",
      );
      expect(reader.catalogEntry(key)).toBeUndefined();
      expect(reader.namedCatalogEntry("codegen", key)).toBeUndefined();
    },
  );

  test("keeps named catalogs within their block and accepts unquoted entries", () => {
    const reader = workspaceCatalog(
      "catalog:\n  typescript: 7.0.0\ncatalogs:\n  codegen:\n    other: 1.0.0\n" +
        "  next:\n    typescript: 6.0.0\noverrides:\n  other: 2.0.0\n",
    );
    expect(reader.catalogEntry("typescript")).toBe("7.0.0");
    expect(reader.namedCatalogEntry("codegen", "typescript")).toBeUndefined();
    expect(reader.namedCatalogEntry("next", "typescript")).toBe("6.0.0");
    expect(reader.namedCatalogEntry("missing", "typescript")).toBeUndefined();
    expect(reader.topLevelBlock("missing")).toEqual([]);
    expect(reader.topLevelBlock("overrides")).toEqual(["  other: 2.0.0", ""]);
  });
});
