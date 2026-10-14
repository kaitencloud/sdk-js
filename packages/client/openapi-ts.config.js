// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";

import { LICENSE_HEADER } from "../../scripts/license-header.mjs";

export default defineConfig({
  input: "../../contracts/openapi.yaml",
  output: {
    path: "src/core/generated",
    // Every generated file opens with the license header, then the generator's own.
    header: ({ defaultValue }) => [...LICENSE_HEADER, "", ...defaultValue],
  },
  plugins: [
    ...defaultPlugins,
    {
      name: "@hey-api/typescript",
      readableNameBuilder: "{{name}}",
    },
    // Emits the fetch client (`client.gen.ts` + `client/`) that transport.ts and
    // index.ts import. openapi-ts 0.99 bundles the client plugins, so it resolves
    // by name without the separate @hey-api/client-fetch package.
    "@hey-api/client-fetch",
  ],
});
