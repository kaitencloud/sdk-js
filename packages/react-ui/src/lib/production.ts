// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/**
 * Whether the host runs a production build: what every development-only warning of this
 * package asks before it speaks.
 *
 * `process.env.NODE_ENV` is read as one whole expression, the form a bundler replaces (Vite,
 * webpack, the `define` of esbuild and Rollup), so a production bundle reads `"production"`
 * here. A `typeof process` check beside it would be left as it is, and is false in a browser:
 * the guard would never see a production bundle. Where nothing replaced the expression and
 * there is no `process` (a browser loading the package without a bundler), reading it throws,
 * and the build counts as development.
 */
export function isProduction(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}
