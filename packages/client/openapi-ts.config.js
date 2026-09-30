import { defaultPlugins, defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../contracts/openapi.yaml",
  output: "src/core/generated",
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
