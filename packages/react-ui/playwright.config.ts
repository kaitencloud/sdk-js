// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression for Storybook stories.
 *
 * Run locally with:
 *   pnpm test:visual                # assumes `pnpm build-storybook` already ran
 *   pnpm test:visual:update         # accept new baselines
 *
 * CI runs `vp run build-storybook` first, then this config serves the
 * `storybook-static/` directory and screenshots a curated allowlist of stories
 * (see `tests/visual/visual.spec.ts`).
 *
 * Baselines live under `tests/visual/__screenshots__/`. They are platform-
 * sensitive (Chromium on Linux); we only commit the Linux baseline since CI is
 * the source of truth — local diffs against macOS/Windows are not committed.
 */
const PORT = 6007;

export default defineConfig({
  testDir: "tests/visual",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "off",
    deviceScaleFactor: 1,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  projects: [
    {
      name: "chromium",
      testDir: "tests/visual",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      /**
       * Layout invariants (`tests/layout`) — container width in, overflow out.
       *
       * Its own project rather than another file under `tests/visual`, because the two
       * suites differ in the way that matters for where they can run: a screenshot is
       * a bitmap and drifts with font rasterisation, so its baselines are Linux-only
       * and CI owns them. An overflow is an integer. It is the same integer on macOS
       * and on the CI runner, so this project needs no baselines, has nothing to
       * update, and is meant to be run locally — `vp run test:layout`.
       */
      name: "layout",
      testDir: "tests/layout",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `node scripts/serve-storybook.mjs storybook-static ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  // Baselines are platform-sensitive (sub-pixel AA differs between macOS/Linux).
  // The Linux CI runner owns the authoritative `*-linux.png` baselines; `*-darwin.png`
  // are dev-local (gitignored, see __screenshots__/.gitignore) because they drift
  // per macOS machine/version and CI never validates them. macOS devs
  // regenerate their own with `--update-snapshots` as needed.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}-{platform}{ext}",
});
