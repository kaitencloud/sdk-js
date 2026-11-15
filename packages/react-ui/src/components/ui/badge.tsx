// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils.ts";

// Kept visually in lockstep with kaiten's design-system badge. NOTE: the SDK's
// token-only CSS build (build-kaiten-css.ts) strips decimal utility classes like
// `px-2.5`/`py-0.5`, so we must use INTEGER spacing (`px-3 py-1`) — otherwise the
// padding silently compiles to nothing and the badge text looks cramped.
// The `success` variant uses emerald-700/white (`.ktn-badge-success`, authored in
// kaiten.css) for legible contrast — the same exception the design-system makes.
const badgeVariants = /* @__PURE__ */ cva(
  "inline-flex items-center border transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      shape: {
        default: "rounded-md px-3 py-1 text-xs font-semibold",
        // The overline pill: the design system's small-caps marker, used for the
        // eyebrow above a section, a plan's "RECOMMENDED" flag, and a feature's
        // lifecycle stage. Mono at 11px because it labels rather than reads —
        // uppercase Inter at this size loses its letterforms where JetBrains Mono
        // keeps them. Letter-spacing stays at 0, as the type styles specify.
        pill: "rounded-full px-3 py-1 font-ktn-mono text-[11px] font-bold uppercase",
      },
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary-hover",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary-hover",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive-hover",
        success: "ktn-badge-success border-transparent shadow",
        // Border only, no fill — so it inherits the text colour of whatever surface it
        // sits on. Pinning `text-foreground` here read as the *page* colour even on a
        // card, which only matched while the two tokens held the same value (see `Card`).
        outline: "",
      },
    },
    defaultVariants: {
      shape: "default",
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, shape, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ shape, variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
