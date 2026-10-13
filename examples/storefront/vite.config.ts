import { defineConfig } from "vite-plus";

import { storefront } from "./server/plugin.ts";

// No React plugin: the build compiles JSX on its own, with the automatic runtime that
// tsconfig.json asks for ("jsx": "react-jsx"). `storefront()` is the backend: see server/plugin.ts.
export default defineConfig({
  plugins: [storefront()],
  test: {
    // The Playwright specs in e2e/ are the runner's own, and import `@playwright/test`.
    include: ["tests/**/*.test.ts"],
  },
});
