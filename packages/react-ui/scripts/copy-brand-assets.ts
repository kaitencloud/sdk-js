import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Copies `src/assets/*.svg` into `dist/assets/` and fixes `new URL("../../assets/…")`
 * emitted next to chunks in `dist/*.mjs` so runtime resolves to `./assets/*.svg`.
 */
export async function copyBrandAssets(outDir: string): Promise<void> {
  const srcAssets = path.resolve("src/assets");
  const destAssets = path.join(outDir, "assets");

  let names: string[];
  try {
    names = await readdir(srcAssets);
  } catch {
    return;
  }

  const svgs = names.filter((n) => n.endsWith(".svg"));
  if (!svgs.length) return;

  await mkdir(destAssets, { recursive: true });
  for (const name of svgs) {
    await copyFile(path.join(srcAssets, name), path.join(destAssets, name));
  }

  const entries = await readdir(outDir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith(".mjs")) continue;
    const abs = path.join(outDir, ent.name);
    const code = (await readFile(abs, "utf8")).toString();
    const next = code.replaceAll('new URL("../../assets/', 'new URL("./assets/');
    if (next !== code) {
      await writeFile(abs, next, "utf8");
    }
  }
}
