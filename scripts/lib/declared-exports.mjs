// What a package's declarations export, by name.
//
// A consumer fixture only names what its author remembered to use. The names a
// package declares are the whole of what a consumer could have used, so a check
// that lists them holds every export of a release, not only the ones a fixture
// happens to touch.
//
// The listing comes from the TypeScript compiler's own reading of the entry
// points (`checker.getExportsOfModule`), so `export *`, renamed exports and
// re-exports from a chunk read the way a consumer's compiler reads them. The
// compiler needed is the 6 line the client installs for its code generation: the
// native 7 has no script API.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { repoRoot } from "./npm-package.mjs";

/** The `typescript` module with a script API, from the client package. */
function loadTypescript() {
  const require = createRequire(join(repoRoot, "packages/client/package.json"));
  const typescript = require("typescript");
  if (typeof typescript.createProgram !== "function") {
    throw new Error("the TypeScript installed for packages/client has no script API");
  }
  return typescript;
}

/**
 * The declaration file of each entry point of an unpacked package, keyed by the
 * entry's name in `exports` (`.`, `./testing`): its `.mjs` file, read as the
 * `.d.mts` beside it. `./package.json` is not code and has none.
 */
export function declarationEntries(packageDir) {
  const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const entries = new Map();
  for (const [name, target] of Object.entries(manifest.exports ?? {})) {
    if (typeof target !== "string" || !target.endsWith(".mjs")) continue;
    const declaration = resolve(packageDir, target.replace(/\.mjs$/, ".d.mts"));
    if (!existsSync(declaration)) {
      throw new Error(`${name} of ${manifest.name} has no declaration file at ${declaration}`);
    }
    entries.set(name, declaration);
  }
  return entries;
}

/**
 * Every name each entry point of the package unpacked at `packageDir` exports,
 * as `Map<entry, Map<name, "value" | "type">>`. A name is a value when it exists
 * at run time (a function, a class, a constant, a namespace) and a type
 * otherwise.
 */
export function declaredExports(packageDir) {
  const typescript = loadTypescript();
  const entries = declarationEntries(packageDir);
  const program = typescript.createProgram({
    rootNames: [...entries.values()],
    options: {
      noEmit: true,
      types: [],
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
      module: typescript.ModuleKind.ESNext,
      moduleResolution: typescript.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
    },
  });
  const checker = program.getTypeChecker();

  const result = new Map();
  for (const [entry, declaration] of entries) {
    const source = program.getSourceFile(declaration);
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol) throw new Error(`${declaration} is not a module the compiler can read`);
    const names = new Map();
    for (const exported of checker.getExportsOfModule(symbol)) {
      const target =
        exported.flags & typescript.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      names.set(exported.getName(), target.flags & typescript.SymbolFlags.Value ? "value" : "type");
    }
    result.set(entry, names);
  }
  return result;
}

/**
 * What `before` exports that `after` does not: a name that is gone, or one that
 * was a value and is now only a type. Returns the lines to print, sorted.
 */
export function lostExports(before, after) {
  const lost = [];
  for (const [entry, names] of before) {
    const now = after.get(entry);
    if (!now) {
      lost.push(`${entry}: the whole entry point`);
      continue;
    }
    for (const [name, kind] of names) {
      const kept = now.get(name);
      if (kept === undefined) lost.push(`${entry}: ${kind} ${name} is no longer exported`);
      else if (kind === "value" && kept === "type") {
        lost.push(`${entry}: ${name} was a value and is now only a type`);
      }
    }
  }
  return lost.sort();
}
