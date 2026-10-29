// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import { isHttpUrl } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { cn } from "../../lib/utils.ts";
import { Button, buttonVariants } from "../ui/button.tsx";
import { useOpensInNewTab } from "./new-tab-hint.ts";

// What the billing screens say to a customer and what they offer them to do: a sentence in one of
// four tones, and a button or a link. They are the checkout's and the portal's both, so that a
// refusal and a way out look the same wherever the customer meets them.
//
// A sentence breaks wherever it has to. A customer's e-mail address is the longest word these
// screens print and it has no space to break at: left alone it runs out of the card and the page
// scrolls sideways on a phone.

export type Tone = "info" | "success" | "warning" | "error" | "muted";

// A success is not said in the success colour: that green is 4.2:1 on the card's secondary
// surface, under what text needs. It is the mark beside the sentence that is green.
//
// Every tone that paints a fill says the text colour that goes with it. A box that sets only
// `bg-secondary` inherits the page's foreground, which a dark theme can make as light as its
// secondary surface (1.00:1 in two of the storefront's), and which the contrast check cannot see:
// it pairs a `text-` token with a `bg-` token only when one className names both.
export const TONES: Record<Tone, string> = {
  info: "rounded-lg border bg-secondary p-3 text-sm text-secondary-foreground [overflow-wrap:anywhere]",
  success:
    "flex items-center gap-2 rounded-lg border border-ktn-success/30 bg-secondary p-3 text-sm font-medium text-secondary-foreground [overflow-wrap:anywhere]",
  // What must not be skimmed past, yet is not a refusal: a stronger border and the warning pair.
  warning:
    "flex items-start gap-2 rounded-lg border-2 border-warning-subtle-foreground/50 bg-warning-subtle p-3 text-sm font-medium text-warning-subtle-foreground [overflow-wrap:anywhere]",
  error:
    "rounded-lg border border-destructive-subtle-foreground/30 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground [overflow-wrap:anywhere]",
  muted: "text-sm text-ktn-muted-foreground [overflow-wrap:anywhere]",
};

/** A sentence for the customer: said politely, and said at once when it is a refusal. */
export function Message({
  text,
  tone,
  unstyled,
  busy,
  slot = "message",
  focusKey,
}: {
  text: string;
  tone: Tone;
  unstyled: boolean;
  busy?: boolean;
  /** The `data-slot` of the sentence, for a host or a test to find it by. */
  slot?: string;
  /** Marks the sentence as somewhere focus can be sent to (see `useFocusScope`), and makes it able to take it. */
  focusKey?: string;
}) {
  const icons = useIcons();
  const CheckIcon = icons.check;
  const WarningIcon = icons.alertTriangle;
  return (
    <p
      data-slot={slot}
      data-tone={tone}
      role={tone === "error" ? "alert" : "status"}
      aria-busy={busy || undefined}
      data-focus={focusKey}
      tabIndex={focusKey ? -1 : undefined}
      className={cn("ktn-own", unstyled ? undefined : TONES[tone])}
    >
      {tone === "success" && !unstyled ? (
        <CheckIcon className="size-4 shrink-0 text-ktn-success" />
      ) : null}
      {tone === "warning" && !unstyled ? <WarningIcon className="mt-0.5 size-4 shrink-0" /> : null}
      {text}
    </p>
  );
}

export interface ActionProps {
  unstyled: boolean;
  variant: "default" | "outline" | "ghost" | "destructive";
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  /** A link instead of a button. */
  href?: string;
  /** A link to the provider's page, in a tab of its own that has no handle on this one. */
  external?: boolean;
  /**
   * Not available yet, and says so: `aria-disabled` and dimmed, yet still focusable and still
   * pressable, so that a press can say what is missing instead of doing nothing. For a button
   * that waits on something the customer can supply, such as a field to fill in.
   */
  unavailable?: boolean;
  /** Takes the width it is given. */
  fill?: boolean;
  /** Default `default`; `sm` for an action in a row. */
  size?: "default" | "sm";
  /** Its name when its text is a symbol. */
  label?: string;
  /**
   * Out of use for now, yet still where the keyboard is: `aria-disabled` instead of `disabled`, so
   * that a control which is pressed, and waits for its answer or has reached its limit, does not drop
   * the customer's place. A press on it does nothing.
   */
  busy?: boolean;
  /** Marks the control as somewhere focus can be sent to (see `useFocusScope`). */
  focusKey?: string;
  /** The id of the sentence that says what the control waits for, read after its name. */
  describedBy?: string;
}

export function Action({
  unstyled,
  variant,
  children,
  disabled,
  onClick,
  href,
  external,
  fill,
  size = "default",
  label,
  busy,
  unavailable,
  focusKey,
  describedBy,
}: ActionProps) {
  const opensInNewTab = useOpensInNewTab();
  const newTabHint = React.useId();
  if (href !== undefined) {
    // A link to the provider's page comes from the API: it is followed only when it is a web address.
    if (external && !isHttpUrl(href)) return null;
    const link = (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label={label}
        aria-describedby={external ? newTabHint : undefined}
        data-focus={focusKey}
        onClick={onClick}
        className={
          unstyled ? undefined : cn("ktn-own", buttonVariants({ variant, size }), fill && "flex-1")
        }
      >
        {children}
      </a>
    );
    // A tab of its own is a change of place, which the link's name does not say: it is its description,
    // read after the name, and nothing on the screen.
    return external ? (
      <>
        {link}
        <span id={newTabHint} hidden>
          {opensInNewTab}
        </span>
      </>
    ) : (
      link
    );
  }
  const press = busy ? undefined : onClick;
  return unstyled ? (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={busy || unavailable || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      data-focus={focusKey}
      onClick={press}
    >
      {children}
    </button>
  ) : (
    <Button
      variant={variant}
      size={size}
      disabled={disabled}
      aria-disabled={busy || unavailable || undefined}
      aria-label={label}
      aria-describedby={describedBy}
      data-focus={focusKey}
      onClick={press}
      className={cn(
        fill ? "flex-1" : undefined,
        // Pressed while something is missing, it says what: the base style takes a press away from
        // every control that is `aria-disabled`, which is right for one that waits on its answer.
        unavailable && !busy ? "aria-disabled:pointer-events-auto" : undefined,
      )}
    >
      {children}
    </Button>
  );
}
