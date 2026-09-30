// The tsgo executable of the workspace root's TypeScript 7, for tsdown's declaration
// step. Left to itself, tsdown resolves `typescript` from the vite-plus instance that
// runs the build: `vp run -r build` runs every package through the root's, and a
// package built on its own uses its own, which is TypeScript 6 in the two packages
// that run openapi-ts. Resolving it here gives every package TypeScript 7's
// declarations, however it is built.
//
// Plain JavaScript with a hand-written tsgo-path.d.mts: a .ts module imported by a
// package's vite.config.ts joins that package's TypeScript program, and tsgo then
// writes its declaration next to it, outside the package.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(new URL("../package.json", import.meta.url));
const manifestPath = require.resolve("typescript/package.json");
const { version } = require(manifestPath);
if (!version.startsWith("7.")) {
  throw new Error(`tsgo ships with TypeScript 7, but the workspace root installs ${version}`);
}

// typescript@7 does not export this file, so it is required by path, as tsdown does.
const getExePath = require(join(dirname(manifestPath), "lib/getExePath.js"));

export const tsgoPath = (typeof getExePath === "function" ? getExePath : getExePath.default)();
