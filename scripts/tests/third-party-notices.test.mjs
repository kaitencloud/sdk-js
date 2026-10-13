// THIRD_PARTY_NOTICES.md names the third-party material that @kaitencloud/react-ui
// copies into its source: the icons it draws and the primitives it derives from
// shadcn/ui. This holds the notice against the source, so that adding an icon, a
// primitive or a file with a drawing of its own is a reason to read the notice.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

import { repoRoot } from "../lib/npm-package.mjs";

const NOTICES = readFileSync(join(repoRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
const UI_SRC = join(repoRoot, "packages/react-ui/src");

/** The icon components of `icons.tsx`, and the Lucide icon each one is copied from. */
const LUCIDE_NAME = {
  CheckIcon: "check",
  XIcon: "x",
  AlertTriangleIcon: "triangle-alert",
  LockIcon: "lock",
  ArrowUpRightIcon: "arrow-up-right",
  ArrowRightIcon: "arrow-right",
  CreditCardIcon: "credit-card",
  PlusIcon: "plus",
  ZapIcon: "zap",
  ShieldIcon: "shield",
  ChevronRightIcon: "chevron-right",
  LoaderIcon: "loader-circle",
  InfinityIcon: "infinity",
};

const compare = (a, b) => a.localeCompare(b);

/** Every file below `dir` whose name ends in one of `extensions`, as paths relative to `dir`. */
function filesBelow(dir, extensions, found = [], prefix = "") {
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) filesBelow(dir, extensions, found, path);
    else if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found.sort(compare);
}

describe("THIRD_PARTY_NOTICES.md against the source of @kaitencloud/react-ui", () => {
  test("names every icon the package draws", () => {
    const icons = readFileSync(join(UI_SRC, "components/shared/icons.tsx"), "utf8");
    const drawn = [...icons.matchAll(/^export function (\w+Icon)\(/gm)].map((match) => match[1]);

    expect(drawn.sort(compare)).toEqual(Object.keys(LUCIDE_NAME).sort(compare));
    for (const name of Object.values(LUCIDE_NAME)) {
      expect(NOTICES, `the Lucide icon ${name}`).toContain(`\`${name}\``);
    }
  });

  test("names every primitive derived from shadcn/ui", () => {
    const primitives = filesBelow(join(UI_SRC, "components/ui"), [".tsx"])
      .filter((file) => !file.endsWith(".stories.tsx"))
      .map((file) => file.replace(/\.tsx$/, ""));

    expect(primitives.length).toBeGreaterThan(0);
    for (const primitive of primitives) {
      const name = primitive.replace(/^./, (letter) => letter.toUpperCase());
      expect(NOTICES, `the primitive ${name}`).toContain(`\`${name}\``);
    }
  });

  test("draws nothing else of its own: another file with an SVG is a file to read", () => {
    const withDrawing = [];
    for (const package_ of ["react-ui", "react"]) {
      const src = join(repoRoot, "packages", package_, "src");
      for (const file of filesBelow(src, [".tsx", ".ts"])) {
        if (file.endsWith(".stories.tsx")) continue;
        if (/<svg\b|<path\b/.test(readFileSync(join(src, file), "utf8"))) {
          withDrawing.push(`${package_}/${file}`);
        }
      }
    }

    // `kaiten-logo.tsx` is Kaiten's own mark, and `icons.tsx` is the Lucide set above.
    expect(withDrawing.sort(compare)).toEqual([
      "react-ui/components/shared/icons.tsx",
      "react-ui/components/shared/kaiten-logo.tsx",
    ]);
  });
});
