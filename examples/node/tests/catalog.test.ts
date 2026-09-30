import { createMockKaitenClient, demoCatalog } from "@kaitencloud/client/testing";
import { describe, expect, test } from "vite-plus/test";

import { readCatalog } from "../src/catalog.ts";

describe("readCatalog", () => {
  test("returns the plans a static pricing page renders", async () => {
    const catalog = demoCatalog();
    const result = await readCatalog(createMockKaitenClient({ catalog }));
    expect(result.plans.map((plan) => plan.slug)).toEqual(catalog.plans.map((plan) => plan.slug));
  });
});
