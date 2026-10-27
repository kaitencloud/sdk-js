// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

/** Readers for the default and named catalogs of a workspace. */
export function workspaceCatalog(workspace) {
  /** The lines under a top-level key, up to the next one. */
  const topLevelBlock = (name) => {
    const lines = workspace.split("\n");
    const start = lines.indexOf(`${name}:`);
    if (start < 0) return [];
    const block = [];
    for (const line of lines.slice(start + 1)) {
      if (line && !/^\s/.test(line)) break;
      block.push(line);
    }
    return block;
  };

  /** A two-space entry from the default catalog. */
  const catalogEntry = (key) => {
    const pattern = new RegExp(`^\\s{2}"?${RegExp.escape(key)}"?:\\s*(.+?)\\s*$`, "m");
    return pattern.exec(workspace)?.[1]?.replace(/^["']|["']$/g, "");
  };

  /** A four-space entry from a named catalog. */
  const namedCatalogEntry = (catalog, key) => {
    const lines = topLevelBlock("catalogs");
    const start = lines.indexOf(`  ${catalog}:`);
    if (start < 0) return undefined;
    const pattern = new RegExp(`^\\s{4}"?${RegExp.escape(key)}"?:\\s*(.+?)\\s*$`);
    for (const line of lines.slice(start + 1)) {
      if (!/^\s{4}/.test(line)) break;
      const match = pattern.exec(line);
      if (match) return match[1].replace(/^["']|["']$/g, "");
    }
    return undefined;
  };

  return { catalogEntry, namedCatalogEntry, topLevelBlock };
}
