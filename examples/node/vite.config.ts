import { defineConfig } from "vite-plus";

// Nothing to configure: this file exists so that the example's tests run on the
// example's own Vitest. Without a config here, `vp run -r test` ran them on the
// workspace root's Vitest, while they import `vite-plus/test` from this
// package's copy. pnpm makes those two separate instances as soon as their peers
// differ (an `@types/node` bump was enough), and every suite then failed at
// collection with "Cannot read properties of undefined (reading 'config')".
export default defineConfig({});
