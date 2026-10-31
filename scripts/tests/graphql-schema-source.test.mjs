// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";

import { printCanonicalSchema, resolveSourceSchema } from "../graphql-schema-source.mjs";
import { fetchPublishedTarball, tarballFile } from "../lib/npm-package.mjs";

vi.mock("../lib/npm-package.mjs", () => ({
  fetchPublishedTarball: vi.fn(),
  tarballFile: vi.fn(),
}));

const SDL = "type Query { ping: String }";

const directories = [];

function temporaryDirectory() {
  const dir = mkdtempSync(join(tmpdir(), "graphql-schema-source-"));
  directories.push(dir);
  return dir;
}

function resolveWith({ schema = "", kaiten = "" } = {}) {
  vi.stubEnv("KAITEN_GRAPHQL_SCHEMA", schema);
  vi.stubEnv("KAITEN_PATH", kaiten);
  return resolveSourceSchema();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveSourceSchema", () => {
  test("fetches the published schema when no source is named", () => {
    fetchPublishedTarball.mockReturnValue("schema.tgz");
    tarballFile.mockReturnValue(SDL);

    expect(resolveWith()).toEqual({
      sdl: printCanonicalSchema(SDL),
      label: "@kaitencloud/graphql-schema@latest",
    });
    expect(fetchPublishedTarball.mock.calls[0][0]).toBe("@kaitencloud/graphql-schema@latest");
    expect(tarballFile).toHaveBeenCalledWith("schema.tgz", "schema.graphqls");
  });

  test("resolves to nothing when npm cannot serve the schema", () => {
    fetchPublishedTarball.mockImplementation(() => {
      throw new Error("registry unreachable");
    });

    expect(resolveWith()).toBeNull();
  });

  test("prefers the file KAITEN_GRAPHQL_SCHEMA names", () => {
    const schema = join(temporaryDirectory(), "schema.graphql");
    writeFileSync(schema, SDL);

    expect(resolveWith({ schema, kaiten: "/nowhere" })).toEqual({
      sdl: printCanonicalSchema(SDL),
      label: schema,
    });
    expect(fetchPublishedTarball).not.toHaveBeenCalled();
  });

  test("reads the checkout KAITEN_PATH names", () => {
    const kaiten = temporaryDirectory();
    const fragment = join(kaiten, "api/internal/infrastructure/http/graphql/schema.graphqls");
    mkdirSync(dirname(fragment), { recursive: true });
    writeFileSync(fragment, SDL);

    expect(resolveWith({ kaiten })?.sdl).toBe(printCanonicalSchema(SDL));
    expect(fetchPublishedTarball).not.toHaveBeenCalled();
  });

  test("does not fall back on npm when KAITEN_PATH names no checkout", () => {
    expect(resolveWith({ kaiten: "/nowhere" })).toBeNull();
    expect(fetchPublishedTarball).not.toHaveBeenCalled();
  });
});
