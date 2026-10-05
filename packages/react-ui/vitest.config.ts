import { defineConfig } from "vite-plus/test/config";

export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.storybook.config.ts"],
  },
});
