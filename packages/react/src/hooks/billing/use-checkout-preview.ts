import * as React from "react";

import type { CheckoutPreview } from "@kaitencloud/client";

import { useKaitenContext } from "../../providers/kaiten-provider.tsx";
import { useTrackHook } from "../../telemetry/context.tsx";
import {
  checkoutInput,
  selectionKey,
  type CheckoutPreviewSelection,
} from "./checkout-selection.ts";
import { checkoutProblem, isVoucherRefusal, type CheckoutProblem } from "./refusals.ts";

/** How long a selection has to stay as it is before what is due for it is asked of the server. */
export const DEFAULT_PREVIEW_DEBOUNCE_MS = 300;

/**
 * Where the voucher code of a selection stands: `none` when there is no code, `checking`
 * while the server is asked, `applied` when it priced the selection with the code, and
 * `rejected` when it refused it. A refusal never says why, and nothing here can tell.
 * `checking` also stands for a code the server could not be reached to judge: the code is
 * held, and goes with the request when it is made again.
 */
export type CheckoutVoucherState = "none" | "checking" | "applied" | "rejected";

export interface CheckoutPreviewState {
  /**
   * `idle` with nothing to price, `loading` while the server is asked (and during the
   * pause before it is), `ready` once it answered for this selection, `failed` when it
   * refused or could not be reached.
   */
  status: "idle" | "loading" | "ready" | "failed";
  /**
   * What is due today, as the server computed it for the last selection it answered:
   * its lines and its total. The SDK adds nothing up, and the lines need not sum to the
   * total. It is kept while a new answer is awaited and after a refusal, so that a
   * summary does not blink away; `isStale` says when it is not the selection's.
   */
  data: CheckoutPreview | null;
  /** `true` when `data` answers another selection than the current one. */
  isStale: boolean;
  voucher: CheckoutVoucherState;
  /** What the refusal of the current selection is, for a screen to word. `null` when it was not refused. */
  problem: CheckoutProblem | null;
  /** The error of the current selection's request, for anything but an invalid voucher. */
  error: Error | null;
  /** Asks again, at once, for a selection whose request failed. */
  retry: () => void;
}

interface Answer {
  key: string;
  data: CheckoutPreview;
}

interface Refusal {
  key: string;
  error: Error;
}

interface Settled {
  answer: Answer | null;
  refusal: Refusal | null;
}

/**
 * What is due today for a selection, from the server: a checkout's `dryRun`, which is the
 * subscription itself rolled back, so that what is shown before paying is what is billed.
 *
 * A request is made when the selection has stood still for `debounceMs` (300 by default),
 * so a quantity stepped up three times is one request, and the first one, with nothing on
 * screen yet, is made at once. An answer that comes after a newer request was made is
 * dropped.
 *
 * A voucher the server refuses leaves the summary that was there, which is still the
 * right one for the rest of the selection, and says so in `voucher`. When there is none
 * for this selection without the code (the code was in from the start, or the plan changed
 * with it) one request is made without it, so that something true is on screen.
 *
 * `null` for `selection` prices nothing, which is how a component that was handed a
 * preview made elsewhere calls it without asking twice. Under any mode but
 * `customer-session` there is no session to ask, and it stays `idle`.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
export function useCheckoutPreview(
  selection: CheckoutPreviewSelection | null,
  options: {
    debounceMs?: number;
    /**
     * A voucher code the checkout itself refused, after this hook had priced the selection
     * with it: the code is then treated as refused here too, and the selection is priced
     * without it.
     */
    refusedVoucherCode?: string | null;
  } = {},
): CheckoutPreviewState {
  useTrackHook("useCheckoutPreview");

  const { sessionClient } = useKaitenContext();
  const debounceMs = options.debounceMs ?? DEFAULT_PREVIEW_DEBOUNCE_MS;
  const [settled, setSettled] = React.useState<Settled>({ answer: null, refusal: null });
  const [attempt, setAttempt] = React.useState(0);
  const settledRef = React.useRef(settled);
  settledRef.current = settled;
  const latest = React.useRef(0);

  // Something to price: a price was chosen, and there is a session to ask.
  const input =
    selection !== null && selection.licensePriceId !== null && sessionClient !== null
      ? selection
      : null;
  const fullKey = input ? selectionKey(input) : null;
  const refusedByCheckout =
    input !== null &&
    options.refusedVoucherCode != null &&
    input.voucherCode.trim() !== "" &&
    input.voucherCode.trim() === options.refusedVoucherCode.trim();
  const refusedVoucher =
    input !== null &&
    input.voucherCode.trim() !== "" &&
    (refusedByCheckout ||
      (settled.refusal?.key === fullKey && isVoucherRefusal(settled.refusal.error)));
  // What is asked for: the selection, or, once its voucher was refused, what is left of it.
  const wanted: CheckoutPreviewSelection | null =
    input === null ? null : refusedVoucher ? { ...input, voucherCode: "" } : input;
  const wantedKey = wanted ? selectionKey(wanted) : null;
  const wantedRef = React.useRef(wanted);
  wantedRef.current = wanted;

  React.useEffect(() => {
    const target = wantedRef.current;
    if (!sessionClient || !target || wantedKey === null) return;
    const { answer, refusal } = settledRef.current;
    if (answer?.key === wantedKey || refusal?.key === wantedKey) return;

    // Nothing on screen yet, or the follow-up to a refused voucher: ask now. A selection
    // that moved while a summary is up waits to see whether it is still moving.
    const delay = answer === null && refusal === null ? 0 : refusedVoucher ? 0 : debounceMs;
    let cancelled = false;
    const timer = setTimeout(() => {
      const request = ++latest.current;
      const outcome = (apply: (previous: Settled) => Settled) => {
        if (!cancelled && request === latest.current) setSettled(apply);
      };
      sessionClient.checkout({ ...checkoutInput(target), dryRun: true }).then(
        (result) =>
          outcome((previous) =>
            result.status === "preview"
              ? {
                  answer: { key: wantedKey, data: result },
                  // The refusal of a voucher stays: it is what the answer is the follow-up to.
                  refusal: previous.refusal?.key === wantedKey ? null : previous.refusal,
                }
              : {
                  ...previous,
                  refusal: {
                    key: wantedKey,
                    error: new Error(`A checkout's dry run answered "${result.status}".`),
                  },
                },
          ),
        (error: unknown) =>
          outcome((previous) => ({
            ...previous,
            refusal: {
              key: wantedKey,
              error: error instanceof Error ? error : new Error(String(error)),
            },
          })),
      );
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `wantedKey` stands for the selection: the effect reads the selection itself from a ref.
  }, [sessionClient, wantedKey, attempt, debounceMs, refusedVoucher]);

  const retry = React.useCallback(() => {
    setSettled((previous) => ({ ...previous, refusal: null }));
    setAttempt((count) => count + 1);
  }, []);

  const { answer, refusal } = settled;
  const answered = answer !== null && answer.key === wantedKey;
  const refused = refusal !== null && refusal.key === wantedKey ? refusal : null;
  const priced = input !== null;
  const hasCode = input !== null && input.voucherCode.trim() !== "";

  const status: CheckoutPreviewState["status"] = !priced
    ? "idle"
    : answered
      ? "ready"
      : refused
        ? "failed"
        : "loading";
  const voucher: CheckoutVoucherState = !hasCode
    ? "none"
    : refusedVoucher
      ? "rejected"
      : fullKey !== null && answer?.key === fullKey
        ? "applied"
        : // Not judged yet: the server is asked, or could not be reached to answer.
          "checking";

  return {
    status,
    data: priced ? (answer?.data ?? null) : null,
    isStale: priced && answer !== null && !answered,
    voucher,
    // A refused voucher is not an error of the summary: it has a state of its own.
    problem: refused
      ? checkoutProblem(refused.error)
      : refusedVoucher
        ? { kind: "voucher_invalid" }
        : null,
    error: refused ? refused.error : null,
    retry,
  };
}
