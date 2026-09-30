// Fetches the published API contract (@kaitencloud/openapi@latest) from npm and
// returns the on-disk path to its openapi.yaml — the single source of truth
// downstream SDKs consume. No checkout of kaiten is involved; the repos are
// decoupled through the published spec.
//
// The package is public, so the fetch needs no token. The registry is still
// named here: a user-level mapping of the @kaitencloud scope to another registry,
// such as GitHub Packages, would otherwise send the fetch there. CI's contract
// workflows fetch the contract themselves and pass it in (KAITEN_OPENAPI).
//
// Returns null (never throws) when the contract can't be fetched: not published
// yet, or the registry unreachable. Both callers, the sync and the drift check,
// fail on it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEC = "@kaitencloud/openapi@latest";
// Passed as a scope setting, not `--registry`: a user-level `@kaitencloud`
// mapping would outrank `--registry` for a scoped package.
const REGISTRY = "--@kaitencloud:registry=https://registry.npmjs.org/";

export function fetchPublishedOpenapi() {
  try {
    const dir = mkdtempSync(join(tmpdir(), "kaiten-openapi-"));
    // Fetch the tarball only — no install, no scripts. Suppress npm's stdout
    // (the tarball filename) so it never pollutes callers' output; keep stderr.
    execFileSync("npm", ["pack", SPEC, REGISTRY, "--pack-destination", dir], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
    if (!tarball) return null;
    execFileSync("tar", ["-xzf", join(dir, tarball), "-C", dir]);
    return join(dir, "package", "openapi.yaml");
  } catch {
    return null;
  }
}
