// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useIcons } from "../../appearance/icons.tsx";
import { useLocalization } from "@kaitencloud/react";
import { cn } from "../../lib/utils.ts";

// The predicate moved to lib/ so the headless entry can export it without this
// component; re-exported here so the components keep one import for both.
export { isUnlimited } from "@kaitencloud/react";

export interface UnlimitedValueProps {
  className?: string;
}

/** The ∞ glyph with an accessible, localized "Unlimited" label. */
export function UnlimitedValue({ className }: UnlimitedValueProps) {
  const icons = useIcons();
  const localization = useLocalization();
  const InfinityGlyph = icons.infinity;
  const label = localization.includedFeatures.unlimited;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-flex items-center text-ktn-muted-foreground", className)}
    >
      <InfinityGlyph className="size-4" />
    </span>
  );
}
