import * as React from "react";
import { useSWRConfig } from "swr";

import type {
  CheckoutInput,
  CheckoutPaymentStatus,
  CheckoutSubscribed,
  SessionInvoice,
} from "@kaitencloud/client";

import { useKaitenContext, useKaitenDataContext } from "../../providers/kaiten-provider.tsx";
import { useTrackHook } from "../../telemetry/context.tsx";
import {
  checkoutInput,
  emptyCheckoutSelection,
  isPlausibleEmail,
  type CheckoutSelection,
} from "./checkout-selection.ts";
import { invalidateInvoices, invalidatePortal } from "./invalidate.ts";
import { checkoutProblem, isVoucherRefusal, type CheckoutProblem } from "./refusals.ts";
import {
  clearPending,
  currentPageUrl,
  openSetupPage,
  savePending,
  waitForReturn,
  type SetupPageOpening,
} from "./setup-return.ts";
import {
  completePaymentMethodSessionOnce,
  type PendingPaymentMethod,
} from "./use-portal-actions.ts";
import { useCheckoutPreview, type CheckoutPreviewState } from "./use-checkout-preview.ts";
import { useInvoiceSettlement, type InvoiceSettlement } from "./use-invoices.ts";
import { useSetupReturn } from "./use-setup-return.ts";

/**
 * Where a checkout stands:
 * - `selecting`: the customer is choosing, and the server prices each choice;
 * - `submitting`: a checkout is being made;
 * - `awaiting_payment_method`: the customer was sent to the provider's page to save a
 *   payment method, and the checkout goes on when they are back;
 * - `subscribed`: the instance is subscribed, whatever became of the payment;
 * - `already_subscribed`: it already was, and a plan change is not a self-serve action.
 */
export type CheckoutStep =
  | "selecting"
  | "submitting"
  | "awaiting_payment_method"
  | "subscribed"
  | "already_subscribed";

/** The provider's page where the customer saves a payment method, as a checkout sent them to it. */
export interface CheckoutSetup {
  url: string;
  sessionId: string;
  expiresAt: string;
  /** How it was opened here; `null` when this page was only reloaded back to the checkout. */
  opening: SetupPageOpening | null;
}

/** How paying the activation invoice went, once the instance is subscribed. */
export interface CheckoutPayment {
  /**
   * `paid`; `requires_action` (the customer must confirm it on `hostedInvoiceUrl`);
   * `failed` (the card was refused: save another, or pay on `hostedInvoiceUrl`);
   * `processing` (not known yet); `not_required` (nothing was due). Open: more may come.
   * A `processing` payment becomes `failed` when the invoice it waits on turns out to have
   * failed: that status is then the invoice's, and the answer's `processing` is behind it.
   */
  status: CheckoutPaymentStatus;
  hostedInvoiceUrl: string | null;
  /** The activation invoice, as last read: the checkout's own, then each read of the invoices. `null` in a trial. */
  invoice: SessionInvoice | null;
  /**
   * What waiting on the invoice has come to, for a payment that has not settled: see
   * {@link InvoiceSettlement}. `idle` when the answer was final.
   */
  settlement: InvoiceSettlement["status"];
  /** Whether nothing more is due: paid, not required, or paid since. */
  isPaid: boolean;
}

export interface UseCheckoutOptions {
  /** The selection the checkout starts with, from a pricing table for instance. */
  initial?: Partial<CheckoutSelection>;
  /**
   * Where the provider's page sends the customer back to, with `kaiten_setup_session`
   * appended: an origin the publishable keys allow. Default: this page, minus its fragment
   * and any `kaiten_*` parameter.
   */
  returnUrl?: string;
  /** How long a selection stays as it is before the server is asked what is due. Default 300 ms. */
  debounceMs?: number;
  /** What sends this page to the provider's, when the browser blocks the popup. Default `location.assign`. */
  navigate?: (url: string) => void;
  /** Called once the instance is subscribed, with the answer. */
  onSubscribed?: (result: CheckoutSubscribed) => void;
}

export interface UseCheckoutResult {
  /** `false` outside `mode="customer-session"`: there is no session to check out with. */
  available: boolean;
  selection: CheckoutSelection;
  select: (patch: Partial<CheckoutSelection>) => void;
  /** Chooses the price (the plan, at a billing period) by its `BillingPrice.id`. */
  selectPrice: (licensePriceId: string | null) => void;
  /** Sets how many units of an add-on are wanted; `0` is none. */
  setAddOnQuantity: (addonSlug: string, quantity: number) => void;
  /** Sets the voucher code, `""` for none. It is sent in the body of the checkout and kept nowhere else. */
  setVoucherCode: (code: string) => void;
  /** Subscribes without the plan's trial. */
  setSkipTrial: (skip: boolean) => void;
  setBillingEmail: (email: string) => void;
  /** What is due today for the selection, as the server computed it. See {@link CheckoutPreviewState}. */
  preview: CheckoutPreviewState;
  /** Whether a billing email has to be given: the customer has none yet. */
  needsBillingEmail: boolean;
  step: CheckoutStep;
  /** Whether {@link submit} will check out: the server priced this selection, and nothing is missing. */
  canSubmit: boolean;
  /**
   * Checks out the selection. When a payment method has to be saved first, the customer is
   * sent to the provider's page (a popup, or this page in its place) and the checkout goes
   * on when they come back; when none has to be, the instance is subscribed at once.
   */
  submit: () => Promise<void>;
  /**
   * Goes on after the customer was on the provider's page: it happens by itself when the
   * page is loaded back, or the popup is done. Call it for one that was closed first, and
   * after a refusal that said no payment method was saved.
   */
  resume: () => Promise<void>;
  /** The provider's page the customer was sent to, while `awaiting_payment_method`. */
  setup: CheckoutSetup | null;
  /** The subscription, once `subscribed`. */
  result: CheckoutSubscribed | null;
  payment: CheckoutPayment | null;
  /** What the last attempt was refused with, for a screen to word. `null` after a success. */
  problem: CheckoutProblem | null;
  /** The error itself, with its status and code. */
  error: Error | null;
  /** Back to choosing, with what was chosen kept: after a refusal to change it, or to start again. */
  reset: () => void;
}

interface Flow {
  step: CheckoutStep;
  setup: CheckoutSetup | null;
  /** What was chosen when the customer was sent away: it is what the checkout goes on with. */
  committed: CheckoutSelection | null;
  result: CheckoutSubscribed | null;
  error: Error | null;
}

const SELECTING: Flow = {
  step: "selecting",
  setup: null,
  committed: null,
  result: null,
  error: null,
};

/** What a checkout keeps while the customer is on the provider's page. */
interface PendingCheckout {
  selection: CheckoutSelection;
  setup: Omit<CheckoutSetup, "opening">;
}

/** The statuses a payment can leave open, which the invoices are read until they settle. */
const OPEN_PAYMENTS: readonly string[] = ["requires_action", "processing"];

/**
 * A customer's checkout of a plan, from choosing it to being subscribed, without a line
 * of markup: the selection, what it costs today, the provider's page for the payment
 * method, the return from it, and what became of the payment.
 *
 * Nothing here adds a price up. The server prices every selection (a checkout's `dryRun`,
 * which is the subscription rolled back) and the checkout bills exactly that. A voucher
 * code is typed, sent in the body of a call and nowhere else: the hook keeps it in memory,
 * and in the tab's `sessionStorage` while the customer is on the provider's page.
 *
 * The flow, for a customer with no payment method: `submit()` makes the checkout, the API
 * answers that a payment method is needed, and the customer is sent to the provider's page,
 * in a popup, or in place of this page when popups are blocked. When they come back, to
 * this page loaded with `kaiten_setup_session` or to the popup that says it is done, the
 * checkout is made again with the setup session, and the instance is subscribed. Mount the
 * hook on the page the customer comes back to: `returnUrl` is this page by default.
 *
 * The instance is subscribed whatever became of the payment. `payment` says what did, and
 * while a payment is still open (`requires_action`, `processing`) the invoices are read
 * until it is settled.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */
export function useCheckout(options: UseCheckoutOptions = {}): UseCheckoutResult {
  useTrackHook("useCheckout");

  const { sessionClient, scopeKey } = useKaitenContext();
  const { portal } = useKaitenDataContext();
  const { mutate } = useSWRConfig();

  const [selection, setSelection] = React.useState(() => emptyCheckoutSelection(options.initial));
  const [flow, setFlow] = React.useState<Flow>(SELECTING);
  // The code the checkout itself refused, which a preview of the same selection had accepted.
  const [refusedVoucherCode, setRefusedVoucherCode] = React.useState<string | null>(null);
  const latest = React.useRef({ selection, flow, options, canSubmit: false });

  const select = React.useCallback(
    (patch: Partial<CheckoutSelection>) => setSelection((previous) => ({ ...previous, ...patch })),
    [],
  );
  const selectPrice = React.useCallback(
    (licensePriceId: string | null) => select({ licensePriceId }),
    [select],
  );
  const setAddOnQuantity = React.useCallback(
    (addonSlug: string, quantity: number) =>
      setSelection((previous) => ({
        ...previous,
        addOns: { ...previous.addOns, [addonSlug]: quantity },
      })),
    [],
  );
  const setVoucherCode = React.useCallback(
    (voucherCode: string) => {
      select({ voucherCode });
      // The refusal of the old code is not the new one's.
      setFlow((previous) =>
        isVoucherRefusal(previous.error) ? { ...previous, error: null } : previous,
      );
    },
    [select],
  );
  const setSkipTrial = React.useCallback((skipTrial: boolean) => select({ skipTrial }), [select]);
  const setBillingEmail = React.useCallback(
    (billingEmail: string) => select({ billingEmail }),
    [select],
  );

  // What is priced is the selection while the customer is choosing, and what was sent to
  // the API once they have chosen.
  const priced = flow.step === "selecting" ? selection : (flow.committed ?? selection);
  const knownWithoutEmail = portal.data?.customer.billingEmail === null;
  // The API asks for the email before it prices anything for a customer that has none:
  // there is nothing to ask it until one is given. Nor until the portal has said whether the
  // customer has one, which a read still under way does not: the first request would be made
  // blind, and refused for it as often as not.
  const waitingForEmail = knownWithoutEmail && !isPlausibleEmail(priced.billingEmail);
  const waitingForPortal = portal.isLoading && portal.data === undefined;
  const preview = useCheckoutPreview(waitingForEmail || waitingForPortal ? null : priced, {
    debounceMs: options.debounceMs,
    refusedVoucherCode,
  });

  const flowProblem = checkoutProblem(flow.error);
  const needsBillingEmail =
    knownWithoutEmail ||
    preview.problem?.kind === "billing_email_required" ||
    flowProblem?.kind === "billing_email_required";
  // What a customer is told is the last attempt's, or else what pricing the selection found: an
  // instance that is subscribed already, a plan it is over. A refused voucher is not one of
  // those: it has its own state.
  const problem =
    flowProblem ?? (preview.problem?.kind === "voucher_invalid" ? null : preview.problem);
  const step: CheckoutStep =
    flow.step === "selecting" && problem?.kind === "already_subscribed"
      ? "already_subscribed"
      : flow.step;

  // ---- The checkout --------------------------------------------------------

  /** One checkout call, for a selection: the first, or the one that goes on after the setup page. */
  const commit = React.useCallback(
    async (chosen: CheckoutSelection, setup: CheckoutSetup | null) => {
      if (!sessionClient) return;
      setFlow({ step: "submitting", setup, committed: chosen, result: null, error: null });
      const input: CheckoutInput = {
        ...checkoutInput(chosen),
        ...(setup
          ? { setupSessionId: setup.sessionId }
          : { returnUrl: latest.current.options.returnUrl ?? currentPageUrl() }),
      };
      try {
        const result = await sessionClient.checkout(input);
        if (result.status === "requires_payment_method") {
          const next = {
            url: result.setupUrl,
            sessionId: result.setupSessionId,
            expiresAt: result.expiresAt,
          };
          const pending: PendingCheckout = { selection: chosen, setup: next };
          savePending("checkout", next.sessionId, pending, next.expiresAt);
          const opening = openSetupPage(next.url, latest.current.options.navigate);
          setFlow({
            step: "awaiting_payment_method",
            setup: { ...next, opening },
            committed: chosen,
            result: null,
            error: null,
          });
          return;
        }
        if (result.status !== "subscribed") {
          throw new Error(`A checkout answered "${result.status}".`);
        }
        clearPending("checkout");
        setFlow({ step: "subscribed", setup: null, committed: chosen, result, error: null });
        void invalidatePortal(mutate, scopeKey);
        void invalidateInvoices(mutate, scopeKey);
        latest.current.options.onSubscribed?.(result);
      } catch (thrown) {
        const error = thrown instanceof Error ? thrown : new Error(String(thrown));
        const refusal = checkoutProblem(error);
        if (refusal?.kind === "voucher_invalid") setRefusedVoucherCode(chosen.voucherCode);
        if (refusal?.kind === "already_subscribed") {
          clearPending("checkout");
          setFlow({
            step: "already_subscribed",
            setup: null,
            committed: chosen,
            result: null,
            error,
          });
          void invalidatePortal(mutate, scopeKey);
          return;
        }
        // With the setup page behind the customer, a refusal to wait out or to retry keeps
        // them there: the same setup session goes through once it can. Anything else asks
        // them to change what they chose, and a new checkout asks the provider again.
        const retryable =
          setup !== null &&
          (refusal?.kind === "setup_incomplete" ||
            refusal?.kind === "unavailable" ||
            refusal?.kind === "rate_limited");
        if (!retryable) clearPending("checkout");
        setFlow(
          retryable
            ? { step: "awaiting_payment_method", setup, committed: chosen, result: null, error }
            : { step: "selecting", setup: null, committed: null, result: null, error },
        );
      }
    },
    [sessionClient, mutate, scopeKey],
  );

  const canSubmit =
    sessionClient !== null &&
    flow.step === "selecting" &&
    selection.licensePriceId !== null &&
    preview.status === "ready" &&
    !preview.isStale &&
    preview.voucher !== "rejected" &&
    preview.voucher !== "checking" &&
    (!needsBillingEmail || isPlausibleEmail(selection.billingEmail));

  latest.current = { selection, flow, options, canSubmit };

  const submit = React.useCallback(async () => {
    if (!sessionClient) {
      setFlow({
        ...SELECTING,
        error: new Error('useCheckout is only available under mode="customer-session".'),
      });
      return;
    }
    const { selection: chosen, flow: current, canSubmit: allowed } = latest.current;
    if (!allowed || current.step !== "selecting" || chosen.licensePriceId === null) return;
    await commit(chosen, null);
  }, [sessionClient, commit]);

  const resume = React.useCallback(async () => {
    const { setup, committed } = latest.current.flow;
    if (!setup || !committed) return;
    await commit(committed, setup);
  }, [commit]);

  // The customer is back in this page: its address carries the setup session, and what they had
  // chosen was kept for it. Or it is a declined card replaced from a payment-method page that a
  // blocked popup sent this page to: nothing else on a checkout's page waits for the customer to
  // be back from it, and the API is told that a payment method was saved so that it is charged.
  useSetupReturn<{ checkout: PendingCheckout; "payment-method": PendingPaymentMethod }>({
    checkout: (_sessionId, pending) => {
      setSelection(pending.selection);
      void commit(pending.selection, { ...pending.setup, opening: null });
    },
    "payment-method": (sessionId) => {
      if (!sessionClient) return;
      completePaymentMethodSessionOnce(sessionClient, sessionId).then(
        () => {
          clearPending("payment-method");
          void invalidatePortal(mutate, scopeKey);
          void invalidateInvoices(mutate, scopeKey);
        },
        () => {
          // The card on the page is where it can be tried again; this one has nothing to show.
        },
      );
    },
  });

  // A selection kept for a setup page this page no longer waits on is not kept: a page that
  // is left while a popup is open takes it away. A page that was sent to the provider's own
  // is not left in this sense, and leaves it for the way back.
  React.useEffect(
    () => () => {
      const { flow: current } = latest.current;
      if (current.step === "awaiting_payment_method" && current.setup?.opening !== "redirect") {
        clearPending("checkout");
      }
    },
    [],
  );

  // The customer is done in the popup beside this page, which says so.
  const popupSession =
    flow.step === "awaiting_payment_method" && flow.setup?.opening === "popup"
      ? flow.setup.sessionId
      : null;
  React.useEffect(() => {
    if (popupSession === null) return;
    return waitForReturn(popupSession, () => void resume());
  }, [popupSession, resume]);

  const reset = React.useCallback(() => {
    clearPending("checkout");
    setRefusedVoucherCode(null);
    setFlow(SELECTING);
  }, []);

  // ---- The payment ---------------------------------------------------------

  const result = flow.result;
  const open = result !== null && OPEN_PAYMENTS.includes(result.payment.status);
  const settlement = useInvoiceSettlement({
    invoiceId: result?.activationInvoice?.id ?? null,
    enabled: open,
    // A payment that was not known to have failed, and has: the card was refused, or the
    // provider wants the customer to confirm it. One that needs the customer to begin with
    // sits as a failed invoice until they do, and is waited on for as long.
    stopOnFailure: result?.payment.status === "processing",
  });
  // The answer said "not known yet" and the invoice says what became of it since.
  const failedSince = settlement.status === "failed";
  const payment: CheckoutPayment | null = result
    ? {
        status: failedSince ? "failed" : result.payment.status,
        hostedInvoiceUrl:
          (failedSince ? settlement.invoice?.hostedInvoiceUrl : null) ??
          result.payment.hostedInvoiceUrl,
        invoice: settlement.invoice ?? result.activationInvoice,
        settlement: settlement.status,
        isPaid:
          result.payment.status === "paid" ||
          result.payment.status === "not_required" ||
          settlement.status === "paid",
      }
    : null;

  return {
    available: sessionClient !== null,
    selection,
    select,
    selectPrice,
    setAddOnQuantity,
    setVoucherCode,
    setSkipTrial,
    setBillingEmail,
    preview,
    needsBillingEmail,
    step,
    canSubmit,
    submit,
    resume,
    setup: flow.setup,
    result,
    payment,
    problem,
    error: flow.error,
    reset,
  };
}
