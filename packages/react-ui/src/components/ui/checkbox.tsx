import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";

import { cn } from "../../lib/utils.ts";
import { CheckIcon } from "../shared/icons.tsx";

/**
 * A box that is ticked or not, on Base UI's checkbox: shadcn's `base-vega` template, the style
 * of the Kaiten console, whose Base UI controls render a native `<button>` and draw their
 * focus as a 3px ring.
 *
 * A checkbox is a control every browser draws its own way, a blue square on most of them, and
 * Base UI's keeps the keyboard, the label's click and the form value of the native one on a
 * control that can be styled. It shares the Base UI the radio group is made of, so it adds
 * almost nothing to a bundle that already has one.
 *
 * The tick is the package's own `CheckIcon`, not one of the host's `appearance` icons: it is
 * the control's mark, and a host that swaps the icons of its cards does not mean this one.
 */
function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      nativeButton
      render={<button />}
      data-slot="checkbox"
      className={cn(
        "ktn-own",
        "peer size-4 shrink-0 rounded-[4px] border border-input shadow-xs transition-shadow outline-none dark:bg-input/30",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className={cn("ktn-own", "flex items-center justify-center text-current transition-none")}
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
