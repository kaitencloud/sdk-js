import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";

// Generates a grouped (class-per-resource) client from the shared contract
// snapshot in contracts/openapi.yaml: one class per tag, covering 100% of the
// contract.
export default defineConfig({
  input: "../../contracts/openapi.yaml",
  output: "src/generated",
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
