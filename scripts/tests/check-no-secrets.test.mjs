// The check that no secret reaches a browser bundle
// (scripts/check-no-secrets-in-example-build.mjs), tried on a clean bundle and on
// planted ones: the real client built for a browser passes, and a token, the name
// of a secret variable and code of the server package each fail it.
//
// Needs the build: `vp run -r build`.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import {
  SERVER_MARKERS,
  clientBundles,
  exampleBrowserBuilds,
  scanBundle,
  scanDirectory,
  scanText,
} from "../check-no-secrets-in-example-build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repoRoot, "scripts/check-no-secrets-in-example-build.mjs");

// Shaped like what Kaiten issues: a prefix and 32 base64url characters. None of
// these is a credential.
const BODY = "0123456789abcdefABCDEF_-0123456789";
const KSH = `ksh_${BODY.slice(0, 32)}`;
const KSM = `ksm_${BODY.slice(0, 32)}`;
const KST = `kst_${BODY.slice(0, 32)}`;
const PK = `pk_${BODY.slice(0, 43).padEnd(43, "x")}`;

let work;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "kaiten-secrets-test-"));
});
afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A build output directory holding the files given, by name. */
function buildOutput(files) {
  const dir = mkdtempSync(join(work, "dist-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

describe("what is a finding", () => {
  test.each([
    ["a ksh_ token", `const t="${KSH}";`, "token"],
    ["a ksm_ token", `headers:{authorization:"Bearer ${KSM}"}`, "token"],
    ["a kst_ token", `fetch(u,{headers:{Authorization:\`Bearer ${KST}\`}})`, "token"],
    ["the name of the API token variable", "process.env.KAITEN_API_TOKEN", "secret-name"],
    [
      "the name of the webhook secret variable",
      "import.meta.env.VITE_KAITEN_WEBHOOK_SECRET",
      "secret-name",
    ],
    ["the name of the minting token variable", "KAITEN_SESSION_MINTING_TOKEN", "secret-name"],
    ["the name of the service token variable", "KAITEN_SERVICE_TOKEN", "secret-name"],
    [
      "a string only the server package contains",
      'throw new Error("Kaiten baseUrl is required")',
      "server-code",
    ],
  ])("%s", (_name, text, kind) => {
    expect(scanText(text).map((finding) => finding.kind)).toContain(kind);
  });

  test.each([
    ["the prefixes of the key guard", 'const p=["sk_","ksh_","ksm_"];s.startsWith("kst_")'],
    [
      "the message that names a prefix",
      "Kaiten: You are using a secret key (ksh_*) in the browser.",
    ],
    ["a sentence that mentions a token", "Call the API from your backend with a ksh_ token."],
    ["a publishable key", `const key="${PK}"`],
    ["a short placeholder", 'const t="ksh_server"'],
    ["a word that only ends like a prefix", `const w="monksh_${BODY}"`],
    ["a variable that holds no secret", "process.env.KAITEN_API_URL; VITE_KAITEN_PUBLISHABLE_KEY"],
  ])("%s is none", (_name, text) => {
    expect(scanText(text)).toEqual([]);
  });

  test("a finding never carries the whole token", () => {
    const [finding] = scanText(`x="${KSH}"`);

    expect(finding.kind).toBe("token");
    expect(finding.detail).not.toContain(KSH);
    expect(finding.detail).not.toContain(KSH.slice(0, 12));
    expect(finding.detail).toContain("ksh_");
  });
});

describe("the markers of server code", () => {
  const server = readFileSync(join(repoRoot, "packages/server/dist/index.mjs"), "utf8");
  const client =
    readFileSync(join(repoRoot, "packages/client/dist/index.mjs"), "utf8") +
    readFileSync(join(repoRoot, "packages/client/dist/testing.mjs"), "utf8");

  test.each(SERVER_MARKERS)("%s is in the server's build and not in the client's", (marker) => {
    expect(server).toContain(marker);
    expect(client).not.toContain(marker);
  });
});

describe("a build output", () => {
  test("that is clean passes", () => {
    const dir = buildOutput({
      "index.html": "<!doctype html><script src=/assets/app.js></script>",
      "assets/app.js": `const guard=["ksh_","ksm_"];const pk="${PK}";`,
    });

    expect(scanDirectory(dir)).toEqual([]);
    expect(run("--dir", dir).status).toBe(0);
  });

  test("that carries a token, a variable name and server code fails, naming each file", () => {
    const dir = buildOutput({
      "index.html": "<!doctype html>",
      "assets/app.js": `fetch(u,{headers:{Authorization:"Bearer ${KSH}"}})`,
      "assets/config.js": "const t=process.env.KAITEN_WEBHOOK_SECRET;export{t}",
      "assets/server.js":
        'class e extends Error{constructor(){super("x"),this.name="KaitenWebhookVerificationError"}}',
    });

    const found = scanDirectory(dir);
    expect(found.map((f) => `${f.file}:${f.kind}`).sort()).toEqual([
      "assets/app.js:token",
      "assets/config.js:secret-name",
      "assets/server.js:server-code",
    ]);

    const result = run("--dir", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("assets/app.js");
    expect(result.stderr).toContain("a Kaiten token");
    expect(result.stderr).not.toContain(KSH);
  });

  test("with an option left without its value, or an argument it does not know, is an error", () => {
    const missing = run("--dir");
    const unknown = run("--dirs", buildOutput({ "app.js": "" }));

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--dir takes a value");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument "--dirs"');
  });

  test("that does not exist is an error, not a pass", () => {
    const result = run("--dir", join(work, "nowhere"));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not a directory");
  });

  test("finds a token in a file that is not text", () => {
    const dir = buildOutput({ "assets/blob.wasm": `\u0000\u0001${KST}\u0002\u0003` });

    expect(scanDirectory(dir).map((f) => f.kind)).toEqual(["token"]);
  });
});

describe("the client built for a browser", () => {
  test("passes, though it contains the prefixes of its key guard", async () => {
    const bundles = await clientBundles();

    expect(bundles).toHaveLength(2);
    for (const bundle of bundles) {
      expect(scanBundle(bundle)).toEqual([]);
    }
    expect(bundles[0].text).toContain("ksh_");
    expect(bundles[0].inputs.some((input) => input.includes("packages/client"))).toBe(true);
  });

  test("the check passes on the repository as it is", () => {
    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("everything @kaitencloud/client exports");
  });
});

describe("the server package in a browser bundle", () => {
  test("is found by the files the bundler took, and by what it left in the output", async () => {
    const result = await esbuild.build({
      stdin: {
        contents: `import { createKaitenClient, verifyKaitenWebhook } from "@kaitencloud/server"; console.log(createKaitenClient, verifyKaitenWebhook);`,
        resolveDir: join(repoRoot, "examples/node/src"),
        loader: "js",
        sourcefile: "host-entry.js",
      },
      absWorkingDir: repoRoot,
      bundle: true,
      format: "esm",
      platform: "browser",
      minify: true,
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const [output] = Object.values(result.metafile.outputs);
    const bundle = {
      name: "a host that imports the server",
      text: result.outputFiles[0].text,
      inputs: Object.keys(output.inputs),
    };

    const findings = scanBundle(bundle).filter((finding) => finding.kind === "server-code");

    expect(findings.some((finding) => finding.detail.includes("packages/server"))).toBe(true);
    expect(
      findings.some((finding) => finding.detail.includes("KaitenWebhookVerificationError")),
    ).toBe(true);
  });
});

describe("the examples that are built for a browser", () => {
  test("are the ones whose build output holds an HTML page", () => {
    const root = mkdtempSync(join(work, "repo-"));
    for (const [name, files] of Object.entries({
      "web/dist": ["index.html", "assets/app.js"],
      "backend/dist": ["server.js"],
      "unbuilt/src": ["main.ts"],
    })) {
      for (const file of files) {
        mkdirSync(dirname(join(root, "examples", name, file)), { recursive: true });
        writeFileSync(join(root, "examples", name, file), "");
      }
    }

    expect(exampleBrowserBuilds(root)).toEqual([join(root, "examples/web/dist")]);
    expect(exampleBrowserBuilds(join(root, "nowhere"))).toEqual([]);
  });
});
