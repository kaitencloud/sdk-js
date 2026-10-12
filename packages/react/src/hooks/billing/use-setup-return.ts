import * as React from "react";

import {
  announceReturn,
  clearKaitenParams,
  readPending,
  readSetupReturn,
  type PendingKind,
} from "./setup-return.ts";

/**
 * Handles the customer coming back from the provider's setup page, on the page they come
 * back to. A flow mounts it once, with a handler for each kind of flow it is, and the one
 * whose kind kept something for this return is called with it.
 *
 * What happens depends on where the customer is back. In the popup a flow opened beside
 * its own page, the page that opened it is waiting: it is told, it carries on, and this
 * window closes. In the page that was sent away, nothing waits: this page picks up
 * what was kept for the setup session and carries on, and takes the `kaiten_*` parameters
 * out of the address so that a reload does not do it twice. A return no pending record of
 * this kind belongs to is left alone, in the address and in storage, for the flow that
 * does own it.
 *
 * The parameter is read when the page first renders, so that every flow mounted by it sees
 * the same return, whichever of them is the first to clear it.
 */
export function useSetupReturn<T extends Partial<Record<PendingKind, unknown>>>(handlers: {
  [K in keyof T & PendingKind]: (sessionId: string, pending: T[K]) => void;
}): void {
  const [sessionId] = React.useState(readSetupReturn);
  const latest = React.useRef(handlers);
  latest.current = handlers;
  // One effect for every kind the page handles: the page that is waiting is told once.
  const kinds = Object.keys(handlers).sort().join();

  React.useEffect(() => {
    if (sessionId === null) return;
    let cancelled = false;
    void announceReturn(sessionId).then((handledElsewhere) => {
      if (cancelled) return;
      if (handledElsewhere) {
        clearKaitenParams();
        try {
          window.close();
        } catch {
          // A window that was not opened by a script cannot be closed by one.
        }
        return;
      }
      for (const kind of kinds.split(",") as (keyof T & PendingKind)[]) {
        const pending = readPending<T[typeof kind]>(kind, sessionId);
        if (pending === null) continue;
        clearKaitenParams();
        latest.current[kind](sessionId, pending);
        return;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [kinds, sessionId]);
}
