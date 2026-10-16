import * as React from "react";

import { cn } from "../../lib/utils.ts";
import { XIcon } from "../shared/icons.tsx";

/**
 * A modal dialog on the native `<dialog>` element.
 *
 * `showModal()` gives the hard paywall everything it asked of Radix — the top
 * layer, a backdrop, focus held inside, Escape to close, focus restored on
 * close, the rest of the page inert — for no dependency at all. And the element
 * stays in the `.kaiten` subtree, so the tokens and the scoped stylesheet reach
 * it without a portal or a z-index. Measured: Radix Dialog cost 13.5 KB gzip,
 * Base UI's 22.5; this costs the browser's own implementation.
 *
 * Two runtimes have no `showModal`: jsdom, and browsers older than 2022. Both
 * keep the `open` attribute this renders and show the dialog inline, and the
 * Escape handler below is what closes it there, so the exit is the same
 * everywhere. That attribute is also what a server render sends, so a hard
 * wall arrives visible in the HTML rather than after hydration.
 */

interface DialogContextValue {
  titleId: string;
  descriptionId: string;
}

const DialogContext = /* @__PURE__ */ React.createContext<DialogContextValue | null>(null);

function useDialogContext(component: string): DialogContextValue {
  const context = React.useContext(DialogContext);
  if (!context) {
    throw new Error(`<${component}> must be rendered inside <Dialog>.`);
  }
  return context;
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface DialogProps extends Omit<
  React.ComponentProps<"dialog">,
  "open" | "onClose" | "onCancel" | "title"
> {
  /**
   * Called once when the user closes the dialog — Escape, or the close button.
   * The caller unmounts it; the dialog does not track an open state of its own.
   */
  onDismiss: () => void;
  showCloseButton?: boolean;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /**
   * The native element with none of the SDK's chrome: no panel, border, padding or shadow, and the
   * close button, when shown, a plain one. It keeps its place in the top layer, centred over its
   * backdrop, as every modal of the SDK's; what it looks like beyond that is the host's.
   */
  unstyled?: boolean;
}

export function Dialog({
  className,
  children,
  onDismiss,
  showCloseButton = true,
  closeLabel = "Close",
  unstyled = false,
  onKeyDown,
  ...props
}: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const dismissedRef = React.useRef(false);
  const onDismissRef = React.useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Once. Under `showModal`, Escape reaches this component's keydown handler
  // AND the browser's own close request, and the caller unmounts on the first;
  // the second arrival must be a no-op.
  const requestClose = React.useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onDismissRef.current();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // StrictMode runs this effect, its cleanup, then this effect again on one
    // mount. The cleanup below marks the dialog dismissed so its own `close()`
    // reports nothing; a rerun must start clean or Escape would never work.
    dismissedRef.current = false;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (typeof element.showModal !== "function") {
      // No top layer here: the dialog is open inline. Move focus in by hand, as
      // the soft wall does, and give it back on unmount.
      element.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      return () => previouslyFocused?.focus({ preventScroll: true });
    }

    // The attribute is rendered for the runtimes without `showModal` and for
    // the server. `showModal` throws on an open dialog, and removing the
    // attribute closes it without a `close` event — unlike `close()`.
    element.removeAttribute("open");
    element.showModal();

    // What react-remove-scroll did for Radix, minus the scrollbar-gap dance: the
    // page behind a modal does not scroll. Restored on unmount.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    return () => {
      root.style.overflow = previousOverflow;
      // Leaving for a reason other than a dismissal (the wall dropped, the
      // provider remounted): closing fires `close`, which must not now report a
      // dismissal to a component that is going away.
      dismissedRef.current = true;
      if (element.open) element.close();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  const context = React.useMemo(() => ({ titleId, descriptionId }), [titleId, descriptionId]);

  return (
    <dialog
      ref={ref}
      // The element's implicit role, stated: hosts and tests address the modal
      // as `[role="dialog"]`, and the fallback runtimes have nothing else to say it.
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      open
      data-slot="dialog-content"
      className={cn(
        "ktn-own ktn-dialog",
        // The chrome the Radix `DialogContent` had — panel, border, shadow — on
        // the element itself, over the UA sheet's white box with a black border.
        // Position and centring are the UA's: a modal dialog sits in the top
        // layer with `inset: 0; margin: auto` (see `.ktn-dialog` in kaiten.css).
        !unstyled &&
          "bg-background text-foreground grid w-[calc(100vw-2rem)] max-w-md gap-4 rounded-lg border p-6 shadow-lg outline-none",
        className,
      )}
      onCancel={(event) => {
        // Escape under `showModal`. Keep the browser from closing it — the
        // caller unmounts on `onDismiss` — so there is one exit path, not two.
        event.preventDefault();
        requestClose();
      }}
      onClose={requestClose}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      {...props}
    >
      <DialogContext.Provider value={context}>
        {children}
        {showCloseButton && unstyled ? (
          <button type="button" data-slot="dialog-close" className="ktn-own" onClick={requestClose}>
            {closeLabel}
          </button>
        ) : showCloseButton ? (
          <button
            type="button"
            data-slot="dialog-close"
            onClick={requestClose}
            className="ktn-own ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </button>
        ) : null}
      </DialogContext.Provider>
    </dialog>
  );
}

/** The dialog's accessible name. Inline, so it composes inside a card's title row. */
export function DialogTitle({
  className,
  unstyled = false,
  ...props
}: React.ComponentProps<"span"> & { unstyled?: boolean }) {
  const { titleId } = useDialogContext("DialogTitle");
  return (
    <span
      id={titleId}
      data-slot="dialog-title"
      className={cn("ktn-own", !unstyled && "text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

/** The dialog's accessible description. */
export function DialogDescription({
  className,
  unstyled = false,
  ...props
}: React.ComponentProps<"p"> & { unstyled?: boolean }) {
  const { descriptionId } = useDialogContext("DialogDescription");
  return (
    <p
      id={descriptionId}
      data-slot="dialog-description"
      className={cn("ktn-own", !unstyled && "text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}
