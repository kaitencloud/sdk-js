// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import type { BillingPrice } from "@kaitencloud/react";

import { cn } from "../../lib/utils.ts";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.tsx";

/**
 * The billing periods of a plan, as one group of choices: native radios when unstyled, the radio
 * group of the console's controls otherwise. A checkout's, a customer's and a visitor's alike.
 */
export function PeriodChoice({
  unstyled,
  legend,
  prices,
  selected,
  disabled,
  unavailable,
  note,
  onSelect,
  label,
}: {
  unstyled: boolean;
  legend: string;
  prices: BillingPrice[];
  selected: string | null;
  disabled: boolean;
  /** The ids of the prices that cannot be chosen: they cannot bill what the instance holds. */
  unavailable: ReadonlySet<string>;
  /** What says why some cannot be chosen. */
  note: string | null;
  onSelect: (id: string) => void;
  label: (price: BillingPrice) => string;
}) {
  const name = React.useId();
  const legendId = React.useId();
  const noteId = React.useId();
  return (
    <fieldset
      data-slot="checkout-flow-period"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
      disabled={disabled}
    >
      <legend id={legendId} className={unstyled ? undefined : "mb-2 text-sm font-medium"}>
        {legend}
      </legend>
      {/* Unstyled, the choices stay native radios, the markup that rendering promises;
          styled, they are drawn by the radio group the console's controls are made of. */}
      {unstyled ? (
        <div>
          {prices.map((price) => (
            <label key={price.id}>
              <input
                type="radio"
                name={name}
                checked={selected === price.id}
                disabled={unavailable.has(price.id)}
                aria-describedby={unavailable.has(price.id) && note ? noteId : undefined}
                onChange={() => onSelect(price.id)}
              />
              {label(price)}
            </label>
          ))}
        </div>
      ) : (
        <RadioGroup
          aria-labelledby={legendId}
          value={selected}
          onValueChange={(id: string) => onSelect(id)}
          disabled={disabled}
          className="flex flex-wrap gap-2"
        >
          {prices.map((price) => (
            <label
              key={price.id}
              className="group/field-label flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-data-checked:border-ktn-primary has-data-checked:ring-2 has-data-checked:ring-ktn-primary/20 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ktn-primary/50 has-disabled:cursor-not-allowed"
            >
              <RadioGroupItem
                value={price.id}
                disabled={unavailable.has(price.id)}
                aria-describedby={unavailable.has(price.id) && note ? noteId : undefined}
              />
              {label(price)}
            </label>
          ))}
        </RadioGroup>
      )}
      {note ? (
        <p id={noteId} className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
          {note}
        </p>
      ) : null}
    </fieldset>
  );
}
