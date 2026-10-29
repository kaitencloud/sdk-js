// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite-plus/test/config";

/** jsdom hook & provider tests under tests/ — the only project this package has. */
export default defineConfig({
  test: {
    name: "unit",
    environment: "jsdom",
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Thresholds are NOT set here on purpose: vite-plus 0.1.24 ignores a
    // `coverage` block in this config entirely (verified — a `lines: 99.9`
    // threshold still exited 0, and include/exclude had no effect). They live on
    // the `test:unit:coverage` script as `--coverage.thresholds.*` CLI flags,
    // which do take effect. A threshold that cannot fail is worse than none.
    //
    // They were recalibrated when the package split: the ratchet measures a
    // different body of code now, so the old numbers meant nothing here. Lines,
    // statements and branches went UP; functions went down to 75, because the
    // three locale packs are ~40 formatter functions of pure data that nothing
    // calls, and they are a far larger share of a package this size.
  },
});
