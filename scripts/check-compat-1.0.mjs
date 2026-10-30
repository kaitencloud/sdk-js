#!/usr/bin/env node
// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Checks immutable 1.0 consumers against npm's immutable 1.0.0 tarball and
// current management consumers against this tree's built tarball. Every compiler
// and consumer module resolution is tested. Historical evaluation code is never
// adapted or restored as a compatibility alias: the OpenFeature policy is major.
// Export checks allow only named policy removals and the historical MeterType
// removal; all remaining management exports must stay values/types as before.
//
//   node scripts/check-compat-1.0.mjs                 # after `vp run -r build`
//   node scripts/check-compat-1.0.mjs --published <tarball> --published-server <tarball>
//
// The first run reads npm; tarballs are unpacked, no dependency scripts run.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readArguments } from "./lib/arguments.mjs";
import { declaredExports, lostExports } from "./lib/declared-exports.mjs";
import {
  PROFILES,
  compile,
  distinctOutputs,
  fetchPublishedTarball,
  integrityOf,
  packWorkspacePackage,
  repoRoot,
  typescriptCompilers,
  unpackAsDependency,
} from "./lib/npm-package.mjs";

const PACKAGE = "@kaitencloud/client";
const PUBLISHED_VERSION = "1.0.0";

/**
 * What npm published 1.0.0 with. A version cannot be published twice, so this never
 * changes; a tarball that differs is not the one consumers have.
 */
export const PUBLISHED_INTEGRITY =
  "sha512-f4hWzqyhiu6Oul1Xoo3OQ3WUe123YEWqBMQEtEVizm1La3vl2THULfTnQLBtN6mPB6zlKwv1QDKwX03CgO0keg==";

/**
 * Deliberate removals, by entry point and release. 1.1.0 removed MeterType,
 * which the API never returned. 2.0.0 removes only the direct flag evaluation
 * surface required by the OpenFeature policy. Management exports stay checked.
 */
export const REMOVED_SINCE_1_0 = new Map([
  [
    ".",
    new Map([
      ["MeterType", "1.1.0"],
      ...[
        "KaitenFlagsModule",
        "BulkEvaluationResponse",
        "EvaluationResult",
        "EvaluationSuccess",
        "EvaluationFailure",
        "FeatureFlagEvaluation",
        "isEvaluationSuccess",
        "isEvaluationFailure",
      ].map((name) => [name, "2.0.0"]),
    ]),
  ],
]);

export const SERVER_REMOVED_SINCE_1_0 = new Map([
  [
    ".",
    new Map(
      [
        "OfrepCore",
        ...["EvaluateFlag", "EvaluateFlagsBulk"].flatMap((operation) =>
          ["Data", "Errors", "Error", "Responses", "Response"].map(
            (suffix) => `${operation}${suffix}`,
          ),
        ),
      ].map((name) => [name, "2.0.0"]),
    ),
  ],
]);

/** A removal ships only as a major release, including Changesets' projected version. */
export function assertOpenFeatureMajorRelease() {
  const changesets = readdirSync(join(repoRoot, ".changeset"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => readFileSync(join(repoRoot, ".changeset", name), "utf8").split("---")[1] ?? "")
    .join("\n");
  for (const pkg of ["client", "server", "react", "react-ui"]) {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, "packages", pkg, "package.json"), "utf8"),
    );
    if (
      Number(manifest.version.split(".")[0]) < 2 &&
      !changesets.includes(`"${manifest.name}": major`)
    ) {
      throw new Failure(`${manifest.name}: OpenFeature policy removals require a major changeset.`);
    }
  }
}

/** `exports` without the names `removed` lists, in a copy. */
export function withoutRemoved(exports, removed = REMOVED_SINCE_1_0) {
  const kept = new Map();
  for (const [entry, names] of exports) {
    const gone = removed.get(entry);
    kept.set(entry, new Map([...names].filter(([name]) => !gone?.has(name))));
  }
  return kept;
}

/** What npm published `@kaitencloud/server` 1.0.0 with. */
export const PUBLISHED_SERVER_INTEGRITY =
  "sha512-aGQwLzfcHSxcHp4wbjAiSiV3s3841Bka7R7fSsenzRJsPipGtfXGwbaNSvOgLXsoHM5l7TYHo4EzkBw8eGwv9Q==";

const SERVER_PACKAGE = "@kaitencloud/server";

/** The consumer fixtures: every `.ts` file of this directory is compiled. */
export const HISTORICAL_CONSUMERS_DIR = join(repoRoot, "packages/client/tests/compat");
export const CONSUMERS_DIR = join(repoRoot, "packages/client/tests/compat-current");

/**
 * Compiles every consumer in `consumersDir` against a package unpacked at
 * `node_modules/@kaitencloud/client` of a throwaway project below `workDir`.
 * Returns one result per compiler and module resolution.
 */
export function compileConsumers({ workDir, label, tarball, consumersDir = CONSUMERS_DIR }) {
  const project = join(workDir, label);
  mkdirSync(join(project, "consumer"), { recursive: true });
  writeFileSync(join(project, "package.json"), '{ "type": "module" }\n');
  unpackAsDependency(tarball, project, PACKAGE);

  const sources = existsSync(consumersDir)
    ? readdirSync(consumersDir).filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    : [];
  if (sources.length === 0) {
    throw new Error(`no consumer fixture (*.ts) in ${consumersDir}`);
  }
  for (const name of sources) {
    writeFileSync(join(project, "consumer", name), readFileSync(join(consumersDir, name)));
  }

  const results = [];
  for (const profile of PROFILES) {
    const config = join(project, `tsconfig.${profile.name}.json`);
    writeFileSync(
      config,
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "es2023",
            lib: ["es2023", "dom"],
            module: profile.module,
            moduleResolution: profile.moduleResolution,
            strict: true,
            noEmit: true,
            // No ambient types: the project compiles on what the package declares.
            types: [],
            // The package's own declarations are checked too: an error inside
            // them is one the consumer's compiler reports as well.
            skipLibCheck: false,
          },
          include: ["consumer/*.ts"],
        },
        null,
        2,
      )}\n`,
    );
    for (const compiler of typescriptCompilers()) {
      const { ok, output } = compile(compiler, config);
      results.push({ label, profile: profile.name, compiler: compiler.name, ok, output });
    }
  }
  return results;
}

/** A failure with something to say to the person who ran the check. */
class Failure extends Error {}

function main() {
  const { values } = readArguments(process.argv.slice(2), {
    options: ["--published", "--published-server"],
  });
  const given =
    values["--published"][0] === undefined ? undefined : resolve(values["--published"][0]);
  const givenServer =
    values["--published-server"][0] === undefined
      ? undefined
      : resolve(values["--published-server"][0]);

  for (const dist of ["packages/client/dist/index.d.mts", "packages/server/dist/index.d.mts"]) {
    if (!existsSync(join(repoRoot, dist))) {
      throw new Failure(
        `${dist.replace(/\/dist\/.*/, "/dist")} is missing: run \`vp run -r build\` first.`,
      );
    }
  }

  assertOpenFeatureMajorRelease();
  const work = mkdtempSync(join(tmpdir(), "kaiten-compat-"));
  try {
    /** The tarball of 1.0.0 of `name`: the one given, or the one npm serves, held to its integrity. */
    const publishedTarball = ({ name, option, given: path, expected }) => {
      let tarball = path;
      if (!tarball) {
        const into = mkdtempSync(join(work, "published-"));
        try {
          tarball = fetchPublishedTarball(`${name}@${PUBLISHED_VERSION}`, into);
        } catch (error) {
          throw new Failure(
            `${name}@${PUBLISHED_VERSION} could not be fetched from npm: ${String(error.stderr ?? error.message).trim()}\n` +
              `  Check that registry.npmjs.org is reachable, or pass a tarball of that version with ${option}.`,
          );
        }
      }
      const integrity = integrityOf(tarball);
      if (integrity !== expected) {
        throw new Failure(
          `The tarball of ${name}@${PUBLISHED_VERSION} is not the one npm published.\n` +
            `  expected ${expected}\n  found    ${integrity}`,
        );
      }
      return tarball;
    };
    const published = publishedTarball({
      name: PACKAGE,
      option: "--published",
      given,
      expected: PUBLISHED_INTEGRITY,
    });
    const publishedServer = publishedTarball({
      name: SERVER_PACKAGE,
      option: "--published-server",
      given: givenServer,
      expected: PUBLISHED_SERVER_INTEGRITY,
    });

    const packed = join(work, "current-tarball");
    mkdirSync(packed);
    const current = packWorkspacePackage(join(repoRoot, "packages/client"), packed);

    const publishedLabel = `${PACKAGE}@${PUBLISHED_VERSION}`;
    const results = [
      ...compileConsumers({
        workDir: work,
        label: publishedLabel,
        tarball: published,
        consumersDir: HISTORICAL_CONSUMERS_DIR,
      }),
      ...compileConsumers({ workDir: work, label: "this tree", tarball: current }),
    ];
    const installed = (label) => join(work, label, "node_modules", ...PACKAGE.split("/"));
    const lost = lostExports(
      withoutRemoved(declaredExports(installed(publishedLabel))),
      declaredExports(installed("this tree")),
    );

    const packedServer = join(work, "current-server-tarball");
    mkdirSync(packedServer);
    const serverLabel = `${SERVER_PACKAGE}@${PUBLISHED_VERSION}`;
    const serverDir = (label, tarball) =>
      unpackAsDependency(tarball, join(work, `server-${label}`), SERVER_PACKAGE);
    const lostFromServer = lostExports(
      withoutRemoved(
        declaredExports(serverDir("published", publishedServer)),
        SERVER_REMOVED_SINCE_1_0,
      ),
      declaredExports(
        serverDir("tree", packWorkspacePackage(join(repoRoot, "packages/server"), packedServer)),
      ),
    );

    for (const { label, profile, compiler, ok } of results) {
      (ok ? console.log : console.error)(
        `${ok ? "✔" : "✘"} ${label === publishedLabel ? "historical 1.0" : "current management"} consumer against ${label}: ${compiler}, ${profile} resolution`,
      );
    }
    for (const { output, labels } of distinctOutputs(
      results,
      ({ label, compiler, profile }) => `${label}, ${compiler}, ${profile} resolution`,
    )) {
      console.error(`\n${labels.join("\n")}\n${output.replace(/^/gm, "    ")}`);
    }
    if (lost.length > 0) {
      console.error(`✘ ${PACKAGE}@${PUBLISHED_VERSION} exports what this tree does not:`);
      for (const line of lost) console.error(`    ${line}`);
    } else {
      console.log(
        `✔ every retained export of ${PACKAGE}@${PUBLISHED_VERSION} is still exported (documented removals excepted)`,
      );
    }
    for (const [entry, names] of REMOVED_SINCE_1_0) {
      for (const [name, release] of names) {
        console.log(`  (${entry}: ${name} was removed on purpose in ${release})`);
      }
    }
    if (lostFromServer.length > 0) {
      console.error(`✘ ${serverLabel} exports what this tree does not:`);
      for (const line of lostFromServer) console.error(`    ${line}`);
    } else {
      console.log(
        `✔ every retained export of ${serverLabel} is still exported (documented OFREP removals excepted)`,
      );
    }
    if (lost.length > 0 || lostFromServer.length > 0) {
      throw new Failure(
        "An export of 1.0.0 is gone, or no longer a value: a consumer may have used it. " +
          "See packages/client/STABILITY.md.",
      );
    }
    if (results.some(({ ok }) => !ok)) {
      throw new Failure(
        "A consumer no longer compiles. If the historical fixture fails against the published tarball, it " +
          "is not 1.0 code; if current management code fails against this tree, the remaining API broke: see packages/client/STABILITY.md.",
      );
    }
    console.log(
      `\nHistorical 1.0 consumers compile against ${PACKAGE}@${PUBLISHED_VERSION}; current management consumers compile against this tree. Only documented major-policy exports are removed.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(`✘ ${error.message}`);
    process.exitCode = 1;
  }
}
