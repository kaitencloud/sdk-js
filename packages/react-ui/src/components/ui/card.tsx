import * as React from "react";

import { cn } from "../../lib/utils.ts";

/**
 * The card owns the text colour for everything inside it.
 *
 * `text-card-foreground` is set here and inherited, so content must not re-pin
 * `text-foreground` (the *page* foreground) on top of it. The two carry identical
 * values in the shipped themes, which is what makes the mistake invisible — until a
 * customer overrides one and not the other. That is one prop away: set
 * `colorForeground` and leave `colorCard` alone, and a re-pinned `text-foreground`
 * renders `#0f172a` on a `#111019` card in dark mode — 1.06:1, and the price on the
 * pricing table was effectively invisible. The presets used to do it themselves,
 * before they became mode-free palettes.
 *
 * Content that needs a quieter tone should use `text-muted-foreground`; content that
 * wants the normal tone should inherit and say nothing.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "ktn-own",
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "ktn-own",
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      /* The display face on every card heading, from one place. The design system
         opposes a geometric grotesque in headings to a neo-grotesque in body copy,
         and a card title is a heading wherever it appears — setting it per-component
         is how half of them end up on the body face. */
      className={cn("ktn-own", "font-display leading-none font-semibold", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("ktn-own", "text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "ktn-own",
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("ktn-own", "px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("ktn-own", "flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
