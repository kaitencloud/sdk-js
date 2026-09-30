import type { CodegenConfig } from "@graphql-codegen/cli";

// Generates from the COMMITTED schema snapshot, exactly the way the REST client
// is generated from contracts/openapi.yaml. Codegen therefore never needs a
// checkout of the API, and the snapshot is the one thing CI has to keep honest.
//
// Refreshing the snapshot is a separate step, so that "what the SDK is built
// against" and "what the backend serves" stay two distinct facts:
//   node scripts/sync-graphql-schema.mjs     # snapshot  <- the Kaiten API
//   vp run generate-graphql                  # types     <- snapshot
// `node scripts/check-graphql-drift.mjs` asserts both links.
const config: CodegenConfig = {
  schema: "../../contracts/schema.graphql",
  documents: ["src/graphql/documents.ts"],
  generates: {
    "./src/graphql/generated/": {
      preset: "client",
      config: {
        documentMode: "string",
        useTypeImports: true,
        // The workspace compiles with moduleResolution=nodenext: relative imports
        // need explicit extensions, so emit ESM ".js" specifiers (mapped to the
        // .ts sources by TypeScript).
        emitLegacyCommonJSImports: false,
        scalars: {
          UUID: "string",
          Time: "string",
          Map: "Record<string, unknown>",
        },
      },
    },
  },
};

export default config;
