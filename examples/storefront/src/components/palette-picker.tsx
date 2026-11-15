// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { usePalette } from "../palette.ts";
import { PALETTES, paletteById } from "../themes/palettes.ts";

/**
 * The theme of the storefront, as a native <select>: it fits a narrow header, and the keyboard, the
 * name and the value are the browser's. The colour mode beside it is a different choice, and is
 * named "Colour mode" for that reason.
 */
export function PalettePicker() {
  const [palette, setPalette] = usePalette();
  return (
    <div className="palette-picker">
      <select
        aria-label="Theme"
        value={palette}
        onChange={(event) => {
          const next = paletteById(event.target.value);
          if (next) setPalette(next.id);
        }}
      >
        {PALETTES.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
