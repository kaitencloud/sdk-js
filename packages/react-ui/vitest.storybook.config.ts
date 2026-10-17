// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath } from "node:url";

import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineConfig } from "vite-plus/test/config";
import { playwright } from "vite-plus/test/browser-playwright";

const dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [storybookTest({ configDir: `${dirname}.storybook` })],
  test: {
    name: "storybook",
    browser: {
      enabled: true,
      headless: true,
      // Storybook sizes each story to 1200x900 through the deprecated
      // `@vitest/browser/context` import, which Vitest 5 no longer serves, and
      // addon-vitest 10.6 swallows the failure: stories fell back to Vitest's 414x896,
      // so the wide ones overflowed and failed axe. Same size, set here. Drop it once
      // @storybook/addon-vitest supports Vitest 5 (storybookjs/storybook#36221).
      viewport: { width: 1200, height: 900 },
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
