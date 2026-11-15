// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite-plus/test/config";

export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.storybook.config.ts"],
  },
});
