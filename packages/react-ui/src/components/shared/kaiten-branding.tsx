// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { useKaitenBranding, useLocalization } from "@kaitencloud/react";

import { cn } from "../../lib/utils.ts";
import { KaitenLogoMark } from "./kaiten-logo.tsx";
import { useOpensInNewTab } from "./new-tab-hint.ts";

export interface KaitenBrandingProps {
  className?: string;
  unstyled?: boolean;
  /**
   * Visual variant:
   * - `footer` (default): flush footer strip, meant to be attached to a `CardFooter`
   *   with negative margins so it visually merges with the hosting card.
   * - `card`: bordered standalone card, used by multi-section layouts (e.g. CustomerPortal)
   *   where the branding lives outside any other card.
   */
  variant?: "footer" | "card";
}

function getPoweredByPrefix(label: string): string {
  const suffix = "Kaiten";
  return label.endsWith(suffix) ? label.slice(0, -suffix.length).trim() : label;
}

export function KaitenBranding({
  className,
  unstyled = false,
  variant = "footer",
}: KaitenBrandingProps) {
  const localization = useLocalization();
  // The rule — server-enforced removal, the bypass audit event, the development
  // warning — is the core's `useKaitenBranding`; this is its default rendering.
  const { hidden } = useKaitenBranding();
  const poweredByPrefix = getPoweredByPrefix(localization.branding.poweredBy);
  // The link opens a tab of its own, which its name does not say: the description is read after it.
  const opensInNewTab = useOpensInNewTab();
  const newTabHint = React.useId();

  if (hidden) {
    return null;
  }

  if (unstyled) {
    return (
      <a
        href="https://kaiten.sh/"
        target="_blank"
        rel="noreferrer"
        aria-label={localization.branding.poweredBy}
        aria-describedby={newTabHint}
        className={cn(
          "flex w-full items-center justify-center gap-2 whitespace-nowrap text-sm font-medium text-ktn-muted-foreground transition-colors hover:text-ktn-foreground",
          className,
        )}
      >
        <span>{poweredByPrefix}</span>
        <KaitenLogoMark className="h-[1.1em] w-auto shrink-0" />
        <span id={newTabHint} hidden>
          {opensInNewTab}
        </span>
      </a>
    );
  }

  // The strip is a quiet surface and its text is a quiet colour, so they are the pair every theme
  // already makes legible (`muted` and `muted-foreground`). It used to be the card tinted with a fifth
  // of the secondary colour, which two dark themes of the storefront make a light slab: the text was
  // 3.92:1 and 4.31:1 on it.
  const containerClass =
    variant === "card"
      ? "flex w-full min-w-0 items-center justify-center rounded-xl border border-ktn-border bg-ktn-card px-6 py-4 shadow-sm"
      : "flex min-w-0 flex-none self-stretch items-center justify-center rounded-b-xl border-t border-ktn-border/80 bg-ktn-muted text-ktn-muted-foreground px-6 py-4";

  return (
    <div data-slot="kaiten-branding" className={cn("ktn-own", containerClass, className)}>
      <a
        href="https://kaiten.sh/"
        target="_blank"
        rel="noreferrer"
        aria-label={localization.branding.poweredBy}
        aria-describedby={newTabHint}
        className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-medium text-ktn-muted-foreground transition-colors hover:text-ktn-foreground"
      >
        <span>{poweredByPrefix}</span>
        <KaitenLogoMark className="h-4 w-auto shrink-0" />
        <span id={newTabHint} hidden>
          {opensInNewTab}
        </span>
      </a>
    </div>
  );
}
