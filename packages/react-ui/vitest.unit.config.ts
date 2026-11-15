// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite-plus/test/config";

/** jsdom component tests under tests/ */
export default defineConfig({
  test: {
    name: "unit",
    environment: "jsdom",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    // `tests/visual/` (visual regression) and `tests/layout/` (container-overflow
    // invariants) are owned by the Playwright runner. Both are *.spec.ts and both
    // import `@playwright/test`, not Vitest, so Vitest must not pick them up — it
    // fails on the `test.describe` with a message about mismatched Playwright
    // versions, which points nowhere near the actual cause.
    exclude: ["tests/visual/**", "tests/layout/**", "**/node_modules/**", "**/dist/**"],
    browser: {
      enabled: false,
    },
    // Coverage settings live on `test:unit:coverage` as CLI flags: older Vite+
    // releases ignored this project's coverage block. Keep the thresholds there,
    // and leave `.storybook/` scaffolding out of the unit ratchet: tests import
    // its doubles, but their unused scenario branches are not component code.
  },
});
