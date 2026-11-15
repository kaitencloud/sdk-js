// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";

import { LICENSE_HEADER } from "../../scripts/license-header.mjs";

// Generates a grouped (class-per-resource) client from the shared contract
// snapshot in contracts/openapi.yaml: one class per management tag.
// OFREP evaluation is intentionally not part of the SDK surface.
export default defineConfig({
  input: "../../contracts/openapi.yaml",
  // Flag evaluation belongs exclusively to OpenFeature and its official OFREP provider.
  // Keep the protocol snapshot intact, but never generate direct SDK evaluation APIs.
  parser: {
    filters: {
      // Webhook payload schemas are not referenced by REST paths; preserve them.
      orphans: true,
      operations: {
        exclude: ["POST /ofrep/v1/evaluate/flags", "POST /ofrep/v1/evaluate/flags/{key}"],
      },
    },
  },
  output: {
    path: "src/generated",
    // Every generated file opens with the license header, then the generator's own.
    header: ({ defaultValue }) => [...LICENSE_HEADER, "", ...defaultValue],
  },
  plugins: [
    ...defaultPlugins,
    {
      name: "@hey-api/typescript",
      readableNameBuilder: "{{name}}",
    },
    {
      name: "@hey-api/sdk",
      operations: { strategy: "byTags" },
    },
    // Emits the fetch client (`client.gen.ts` + `client/`) that index.ts imports.
    // openapi-ts 0.99 bundles the client plugins, so it resolves by name without
    // the separate @hey-api/client-fetch package.
    "@hey-api/client-fetch",
  ],
});
