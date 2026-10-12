import * as React from "react";

import { isHttpUrl } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { cn } from "../../lib/utils.ts";
import { Button, buttonVariants } from "../ui/button.tsx";

// What the billing screens say to a customer and what they offer them to do: a sentence in one of
// four tones, and a button or a link. They are the checkout's and the portal's both, so that a
// refusal and a way out look the same wherever the customer meets them.

export type Tone = "info" | "success" | "error" | "muted";

// A success is not said in the success colour: that green is 4.2:1 on the card's secondary
// surface, under what text needs. It is the mark beside the sentence that is green.
export const TONES: Record<Tone, string> = {
  info: "rounded-lg border bg-secondary p-3 text-sm",
  success:
    "flex items-center gap-2 rounded-lg border border-ktn-success/30 bg-secondary p-3 text-sm font-medium",
  error:
    "rounded-lg border border-destructive-subtle-foreground/30 bg-destructive-subtle p-3 text-sm text-destructive-subtle-foreground",
  muted: "text-sm text-ktn-muted-foreground",
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
  const CheckIcon = useIcons().check;
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
  focusKey,
}: ActionProps) {
  if (href !== undefined) {
    // A link to the provider's page comes from the API: it is followed only when it is a web address.
    if (external && !isHttpUrl(href)) return null;
    return (
      <a
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label={label}
        data-focus={focusKey}
        onClick={onClick}
        className={
          unstyled ? undefined : cn("ktn-own", buttonVariants({ variant, size }), fill && "flex-1")
        }
      >
        {children}
      </a>
    );
  }
  const press = busy ? undefined : onClick;
  return unstyled ? (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-label={label}
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
      aria-disabled={busy || undefined}
      aria-label={label}
      data-focus={focusKey}
      onClick={press}
      className={fill ? "flex-1" : undefined}
    >
      {children}
    </Button>
  );
}
