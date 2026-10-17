// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { cn } from "../../lib/utils.ts";
import { emitKaitenEvent, useLocalization } from "@kaitencloud/react";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { useTrackComponent } from "@kaitencloud/react/internal";
import { Button } from "../ui/button.tsx";

export interface UpgradeButtonProps {
  /** Called on click — wire it to your checkout / pricing route. */
  onUpgrade?: () => void;
  /** Button label. Defaults to the localized "Upgrade" string. */
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  unstyled?: boolean;
  className?: string;
}

/**
 * A drop-anywhere "upgrade" CTA. On click it emits the `kaiten:plan-changed`
 * intent event (so a host can react centrally) and calls `onUpgrade`. It does NOT
 * itself change the plan — Kaiten has no checkout backend; this is the intent +
 * hand-off primitive.
 * @experimental
 */
export function UpgradeButton({
  onUpgrade,
  label,
  variant = "default",
  unstyled = false,
  className,
}: UpgradeButtonProps) {
  useAssertWrappedByKaitenProvider("UpgradeButton");
  useTrackComponent("UpgradeButton");

  const localization = useLocalization();
  const text = label ?? localization.paywall.upgrade;

  const handleClick = () => {
    emitKaitenEvent("kaiten:plan-changed", {
      metadata: { source: "upgrade-button", intent: true },
    });
    onUpgrade?.();
  };

  if (unstyled) {
    return (
      <button
        type="button"
        data-slot="upgrade-button"
        className={cn("ktn-own", className)}
        onClick={handleClick}
      >
        {text}
      </button>
    );
  }

  return (
    <Button
      type="button"
      data-slot="upgrade-button"
      variant={variant}
      className={cn("ktn-own", className)}
      onClick={handleClick}
    >
      {text}
    </Button>
  );
}
