import * as React from "react";

/** How many renders a request waits for its target to appear before it falls back to the root. */
const RENDERS_TO_WAIT = 3;

/**
 * Where the keyboard goes when what it was on goes away.
 *
 * A control that is pressed and then replaced (a "Cancel" that opens a question, a field that turns
 * into "applied") leaves focus on the page's body, and a keyboard or screen-reader user starts over
 * from the top. The part of a screen that does this marks the controls and sentences focus can be
 * sent to with `focusKey` (a `data-focus` attribute), puts `ref` on its root, and calls `focus` with
 * the keys it prefers, in order, once the change is made. Focus is moved after the next render, to the
 * first of them that is there, and only when it is lost or still inside the root: a customer who
 * has moved on elsewhere is left where they are.
 */
export function useFocusScope(): {
  ref: (element: HTMLElement | null) => void;
  focus: (...keys: string[]) => void;
} {
  const anchor = React.useRef<HTMLElement | null>(null);
  const ref = React.useCallback((element: HTMLElement | null) => {
    anchor.current = element;
  }, []);
  const wanted = React.useRef<{ keys: string[]; seen: number } | null>(null);
  const [, render] = React.useReducer((count: number) => count + 1, 0);

  React.useEffect(() => {
    const request = wanted.current;
    const root = anchor.current;
    if (request === null || root === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && !root.contains(active)) {
      wanted.current = null;
      return;
    }
    for (const key of request.keys) {
      const target = root.querySelector<HTMLElement>(`[data-focus="${key}"]`);
      if (target && target.getAttribute("disabled") === null) {
        wanted.current = null;
        target.focus();
        return;
      }
    }
    // What a change brings may arrive a render later than the request that waits on it.
    if (++request.seen < RENDERS_TO_WAIT) {
      setTimeout(render, 0);
      return;
    }
    wanted.current = null;
    if (root.hasAttribute("tabindex")) root.focus();
  });

  const focus = React.useCallback((...keys: string[]) => {
    wanted.current = { keys, seen: 0 };
    render();
  }, []);

  return { ref, focus };
}
