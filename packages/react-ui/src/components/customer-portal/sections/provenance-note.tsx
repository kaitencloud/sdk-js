import * as React from "react";

import type { EntitlementProvenance, KaitenPortalBillingWords } from "@kaitencloud/react";

import { cn } from "../../../lib/utils.ts";
import { usePortalBillingWords } from "../../shared/billing-words.ts";

interface Term {
  negative: boolean;
  text: string;
}

const format = (value: number) => Math.abs(value).toLocaleString();

/**
 * How a number limit is made up, in the server's own figures: "(100,000 base) × 2 voucher =
 * 200,000". The server settles the arithmetic and sends every step of it; this writes them down,
 * and adds nothing up. What the voucher is called is all that is said of it: never its code, which
 * the portal does not carry.
 *
 * `null` for a limit that nothing but the licence sets, which has nothing to explain.
 */
export function provenanceExpression(
  provenance: EntitlementProvenance | undefined,
  words: KaitenPortalBillingWords,
): string | null {
  const number = provenance?.number;
  if (!provenance || !number) return null;
  if (number.unlimited) return words.provenanceUnlimited;

  const terms: Term[] = [];
  const positive = (text: string) => terms.push({ negative: false, text });
  if (number.boostSet !== null) {
    positive(`${format(number.boostSet)} ${words.provenanceVoucher}`);
  } else if (provenance.addons.some((addon) => addon.overrideBehavior !== "ADD")) {
    // An add-on that overrides the licence, or lifts it to a floor, is not a term to write down:
    // the figure after the add-ons is the server's, and the only honest one.
    positive(`${format(number.afterAddons)} ${words.provenanceWithAddOns}`);
  } else {
    if (number.license !== null) positive(`${format(number.license)} ${words.provenanceBase}`);
    for (const addon of provenance.addons) {
      if (addon.value.type === "number") {
        positive(`${addon.quantity} × ${format(addon.value.value)} ${words.provenanceAddOn}`);
      }
    }
  }
  if (number.boostAdd !== null) {
    terms.push({
      negative: number.boostAdd < 0,
      text: `${format(number.boostAdd)} ${words.provenanceVoucher}`,
    });
  }
  if (terms.length === 0) return null;

  let expression = terms
    .map((term, index) =>
      index === 0
        ? `${term.negative ? "−" : ""}${term.text}`
        : `${term.negative ? "−" : "+"} ${term.text}`,
    )
    .join(" ");
  if (number.boostMultiply !== null) {
    expression = `(${expression}) × ${format(number.boostMultiply)} ${words.provenanceVoucher}`;
  }
  return `${expression} = ${number.effective.toLocaleString()}`;
}

/**
 * A button beside a limit that opens, in place, where that limit comes from. Nothing when the
 * licence alone sets it. It opens on a click, a tap or a key, and not on hover: a touch screen has
 * none, and text that appears under a pointer moves what is around it.
 */
export function ProvenanceNote({
  name,
  provenance,
  className,
  unstyled = false,
}: {
  /** The entitlement's name, for the button's accessible name. */
  name: string;
  provenance: EntitlementProvenance | undefined;
  className?: string;
  /** Plain markup, with no class: the note of a host that draws its own. */
  unstyled?: boolean;
}) {
  const words = usePortalBillingWords();
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const expression = provenanceExpression(provenance, words);
  if (!expression) return null;

  if (unstyled) {
    return (
      <span data-slot="provenance" className="ktn-own">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`${words.provenance}: ${name}`}
          onClick={() => setOpen((value) => !value)}
        >
          <span aria-hidden="true">i</span>
        </button>
        {open ? (
          <span id={id} role="note">
            {expression}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <div data-slot="provenance" className={cn("ktn-own mt-1 flex items-start gap-2", className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${words.provenance}: ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="ktn-own inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-ktn-border font-ktn-mono text-[11px] leading-none text-ktn-muted-foreground hover:bg-ktn-secondary focus-visible:ring-2 focus-visible:ring-ktn-primary/50 focus-visible:outline-none"
      >
        <span aria-hidden="true">i</span>
      </button>
      {open ? (
        <p
          id={id}
          role="note"
          className="ktn-own min-w-0 flex-1 text-xs break-words text-ktn-muted-foreground"
        >
          {expression}
        </p>
      ) : null}
    </div>
  );
}
