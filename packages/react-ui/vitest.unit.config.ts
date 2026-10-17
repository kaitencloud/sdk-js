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
    // Thresholds are NOT set here on purpose: vite-plus 0.1.24 ignores a
    // `coverage` block in this config entirely (verified — a `lines: 99.9`
    // threshold still exited 0, and include/exclude had no effect). They live on
    // the `test:unit:coverage` script as `--coverage.thresholds.*` CLI flags,
    // which do take effect. A threshold that cannot fail is worse than none.
  },
});
