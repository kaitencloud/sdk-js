import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "../../lib/utils.ts";

/**
 * A set of choices of which exactly one is taken, on Base UI's radio group: shadcn's
 * `base-vega` template, the style of the Kaiten console, whose Base UI controls render
 * a native `<button>` and draw their focus as a 3px ring.
 *
 * Base UI is the one primitive library the package carries, for this alone: a radio is
 * a control every browser draws its own way, and Base UI's brings the roving focus and
 * the arrow keys of a radio group to one that can be styled. It costs 12 KB gzip, to
 * the components that offer a choice.
 */
function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("ktn-own", "grid w-full gap-3", className)}
      {...props}
    />
  );
}

// A `<button>` rather than Base UI's default `<span>`: a disabled `<fieldset>` around
// it then disables it as it does any control, and `disabled:` styles it. Inside a label
// with the `group/field-label` class, a choice drawn as a card, the label shows the
// focus and the item draws no ring of its own.
function RadioGroupItem({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      nativeButton
      render={<button />}
      data-slot="radio-group-item"
      className={cn(
        "ktn-own",
        "peer relative flex aspect-square size-4 shrink-0 rounded-full border border-input shadow-xs transition-[color,box-shadow] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 dark:bg-input/30",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "group-has-[:focus-visible]/field-label:ring-0 group-has-[:focus-visible]/field-label:not-data-checked:border-input group-has-[:focus-visible]/field-label:data-checked:border-primary",
        "aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:aria-checked:border-primary dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className={cn("ktn-own", "flex size-4 items-center justify-center")}
      >
        <span className="absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-foreground" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  );
}

export { RadioGroup, RadioGroupItem };
