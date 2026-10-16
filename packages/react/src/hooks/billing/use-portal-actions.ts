import * as React from "react";
import { useSWRConfig } from "swr";

import { BoundaryPendingError } from "@kaitencloud/client";
import type {
  KaitenSessionClientLike,
  PaymentMethodSummary,
  PortalSession,
  PortalSubscription,
  SessionAddon,
  VoucherValidation,
} from "@kaitencloud/client";

import { useKaitenContext } from "../../providers/kaiten-provider.tsx";
import { useTrackHook } from "../../telemetry/context.tsx";
import { useKaitenMutation, type UseKaitenMutationResult } from "../use-kaiten-query.ts";
import { kaitenKeys } from "../query-keys.ts";
import { invalidateInvoices, invalidatePortal } from "./invalidate.ts";
import { addonQuantityProblem, type AddonQuantityProblem } from "./refusals.ts";
import {
  clearPending,
  currentPageUrl,
  openSetupPage,
  savePending,
  sendPageTo,
  waitForReturn,
} from "./setup-return.ts";
import { useSetupReturn } from "./use-setup-return.ts";

/**
 * The longest a refused change is waited out before it is sent again, in seconds. A refusal
 * that asks for more than this is the answer: waiting two minutes on a button is not a state
 * a screen can show.
 */
export const MAX_BOUNDARY_WAIT_SECONDS = 120;

/**
 * What a change to the subscription is, as a hook: a mutation of the session's routes, whose
 * success reads the portal again (and the invoices, when it moves them).
 */
export interface UsePortalActionResult<TInput, TOutput> extends UseKaitenMutationResult<
  TInput,
  TOutput
> {
  /**
   * When a change the API refused for now will be sent again, in milliseconds since the epoch
   * (as `Date.now()` counts them), `null` when none waits. `isPending` stays true until then
   * and through the second try.
   */
  retryAt: number | null;
}

interface PortalActionOptions<TOutput> {
  onSuccess?: (data: TOutput) => void;
  onError?: (error: Error) => void;
}

interface SessionMutationConfig<TInput, TOutput> extends PortalActionOptions<TOutput> {
  hook: string;
  call: (client: KaitenSessionClientLike, input: TInput) => Promise<TOutput>;
  /** Whether what it changes shows on the invoices too. */
  movesInvoices?: boolean;
  /**
   * Whether the refusal of a billing period that is still being closed is waited out and the
   * change sent once more. It is a refusal that changed nothing, so sending it again is safe.
   */
  waitsOutBoundary?: boolean;
}

function useSessionMutation<TInput, TOutput>(
  config: SessionMutationConfig<TInput, TOutput>,
): UsePortalActionResult<TInput, TOutput> {
  useTrackHook(config.hook);

  const { sessionClient, scopeKey, mode } = useKaitenContext();
  const { mutate } = useSWRConfig();
  const [retryAt, setRetryAt] = React.useState<number | null>(null);
  const call = React.useRef(config.call);
  call.current = config.call;
  const waiting = React.useRef<(() => void) | null>(null);

  // A wait that the screen went away from is not carried through.
  React.useEffect(() => () => waiting.current?.(), []);

  /** Waits `seconds`; resolves to false when the wait was cut short. */
  const wait = React.useCallback((seconds: number) => {
    setRetryAt(Date.now() + seconds * 1000);
    return new Promise<boolean>((resolve) => {
      const done = (completed: boolean) => {
        clearTimeout(timer);
        waiting.current = null;
        setRetryAt(null);
        resolve(completed);
      };
      const timer = setTimeout(() => done(true), seconds * 1000);
      waiting.current = () => done(false);
    });
  }, []);

  const mutation = useKaitenMutation<TInput, TOutput>({
    mutationFn: async (input) => {
      if (!sessionClient) {
        throw new Error(
          `${config.hook} is only available under mode="customer-session", not under mode="${mode}".`,
        );
      }
      try {
        return await call.current(sessionClient, input);
      } catch (error) {
        if (
          !config.waitsOutBoundary ||
          !(error instanceof BoundaryPendingError) ||
          error.retryAfterSeconds > MAX_BOUNDARY_WAIT_SECONDS
        ) {
          throw error;
        }
        // The period that ended is being closed, and nothing was changed: once it is,
        // the same change goes through. One more try, and what it answers is the answer.
        if (!(await wait(error.retryAfterSeconds))) throw error;
        return call.current(sessionClient, input);
      }
    },
    onSuccess: (data) => {
      if (config.movesInvoices) void invalidateInvoices(mutate, scopeKey);
      config.onSuccess?.(data);
    },
    onError: config.onError,
    // The portal says what the change did: it is read again before the call resolves.
    revalidateKeys: [kaitenKeys.components.portal(scopeKey)],
  });

  return { ...mutation, retryAt };
}

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

/**
 * Cancels the subscription at the end of its current period: `mutate({ reason })`, the
 * reason being optional. The customer keeps what they bought until then. A refusal the API
 * makes while the period that ended is being closed (`BoundaryPendingError`) is waited out
 * and the call made once more, `retryAt` saying when; any other refusal is the error.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useCancelSubscription(
  options: PortalActionOptions<PortalSubscription> = {},
): UsePortalActionResult<{ reason?: string } | void, PortalSubscription> {
  return useSessionMutation({
    hook: "useCancelSubscription",
    call: (client, input) => client.cancelSubscription(input ?? undefined),
    waitsOutBoundary: true,
    ...options,
  });
}

/**
 * Withdraws a cancellation scheduled for the end of the period. Waits out a billing period
 * that is being closed like {@link useCancelSubscription}.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useReactivateSubscription(
  options: PortalActionOptions<PortalSubscription> = {},
): UsePortalActionResult<void, PortalSubscription> {
  return useSessionMutation({
    hook: "useReactivateSubscription",
    call: (client) => client.reactivateSubscription(),
    waitsOutBoundary: true,
    ...options,
  });
}

export interface UseSetAddonQuantityResult extends UsePortalActionResult<
  { addonSlug: string; quantity: number },
  SessionAddon
> {
  /**
   * What the last change was refused with, as a kind a screen chooses its words by: an add-on no
   * longer for sale, one in another currency, one that does not fit the plan, too many units,
   * another version held, a subscription that waits for its payment, a session with no instance, a
   * period still being closed, a provider that is down.
   * `null` when the last change was not refused; `error` is the error itself.
   */
  problem: AddonQuantityProblem | null;
}

/**
 * Sets how many units of an add-on the instance holds: `mutate({ addonSlug, quantity })`,
 * `0` detaching it. The change is billed from the next renewal. Waits out a billing period
 * that is being closed like {@link useCancelSubscription}, and names what any other refusal is
 * in `problem`.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useSetAddonQuantity(
  options: PortalActionOptions<SessionAddon> = {},
): UseSetAddonQuantityResult {
  const mutation = useSessionMutation<{ addonSlug: string; quantity: number }, SessionAddon>({
    hook: "useSetAddonQuantity",
    call: (client, { addonSlug, quantity }) => client.setAddonQuantity(addonSlug, quantity),
    waitsOutBoundary: true,
    ...options,
  });
  const problem = React.useMemo(() => addonQuantityProblem(mutation.error), [mutation.error]);
  return { ...mutation, problem };
}

// ---------------------------------------------------------------------------
// The provider's pages
// ---------------------------------------------------------------------------

export interface UseBillingPortalOptions extends PortalActionOptions<PortalSession> {
  /** What sends the customer to the provider's portal. Default `location.assign`. */
  navigate?: (url: string) => void;
}

export interface UseBillingPortalResult extends UsePortalActionResult<
  { returnUrl?: string } | void,
  PortalSession
> {
  /**
   * Asks for a link to the provider's billing portal and sends the customer there. Rejects with
   * the refusal when no link could be had, which `error` holds too.
   */
  open: () => Promise<void>;
}

/**
 * The payment provider's own billing portal, where a customer manages their card, their
 * details and their invoices: `open()` asks for a link, which is the provider's and lasts
 * a moment, and sends the customer to it. They come back to the page they were on, minus
 * any `kaiten_*` parameter. To bring them back elsewhere, ask for the link with
 * `mutateAsync({ returnUrl })` and send them to its `url` yourself: `mutate` and `mutateAsync`
 * only ask for it.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useBillingPortal(options: UseBillingPortalOptions = {}): UseBillingPortalResult {
  const { navigate, ...rest } = options;
  const mutation = useSessionMutation<{ returnUrl?: string } | void, PortalSession>({
    hook: "useBillingPortal",
    call: (client, input) =>
      client.createPortalSession({ returnUrl: input?.returnUrl ?? currentPageUrl() }),
    ...rest,
  });
  const { mutateAsync } = mutation;
  const open = React.useCallback(async () => {
    const { url } = await mutateAsync();
    sendPageTo(url, navigate);
  }, [mutateAsync, navigate]);
  return { ...mutation, open };
}

/**
 * Checks a voucher code on its own: `mutate({ code, licensePriceId })` resolves to `{ valid:
 * false }` for every reason a code cannot be used, with nothing to tell which, and to `{
 * valid: true, voucher }` with what it gives, never its code. It redeems nothing: the code is
 * redeemed by the checkout that carries it. Checks are rate limited, per session and per
 * customer, and the refusal that says so is a `RateLimitedError` with the wait.
 *
 * The code travels in the body of the call and is not kept by the hook.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function useValidateVoucher(
  options: PortalActionOptions<VoucherValidation> = {},
): UsePortalActionResult<{ code: string; licensePriceId?: string }, VoucherValidation> {
  return useSessionMutation({
    hook: "useValidateVoucher",
    call: (client, input) => client.validateVoucher(input),
    ...options,
  });
}

// ---------------------------------------------------------------------------
// The payment method
// ---------------------------------------------------------------------------

export interface UsePaymentMethodSessionOptions {
  /**
   * Where the provider's page opens: `redirect` in place of this page, which is where a
   * portal sends the customer, or `popup` beside it, which keeps a flow that is under way
   * (a checkout whose payment failed) on screen. A popup the browser blocks is a redirect.
   * Default `redirect`.
   */
  opening?: "redirect" | "popup";
  /** The currency to set the payment method up in. Needed only when the customer has no live subscription. */
  currencyCode?: string;
  /** Where the page sends the customer back to. Default: this page, minus any `kaiten_*` parameter. */
  returnUrl?: string;
  /** What sends the page to the provider's, for a `redirect`. Default `location.assign`. */
  navigate?: (url: string) => void;
  onSaved?: (paymentMethod: PaymentMethodSummary) => void;
}

export interface UsePaymentMethodSessionResult {
  /**
   * `idle`; `opening` while the page's address is asked for; `awaiting` while the customer
   * is on it; `saving` while the API checks with the provider that a payment method was
   * saved; `saved`; `failed`.
   */
  status: "idle" | "opening" | "awaiting" | "saving" | "saved" | "failed";
  /** The payment method that is charged now, once `saved`. Its labels, never its number. */
  paymentMethod: PaymentMethodSummary | null;
  error: Error | null;
  /** Asks for a hosted page where the customer saves a payment method, and sends them to it. */
  start: () => Promise<void>;
  /**
   * Checks again that a payment method was saved on the page the customer was sent to: after
   * a refusal that said it was not (`SessionNotComplete`), once they did.
   */
  complete: () => Promise<void>;
}

/** What the payment-method flow keeps while the customer is on the provider's page. */
export interface PendingPaymentMethod {
  sessionId: string;
}

const completions = new WeakMap<
  KaitenSessionClientLike,
  Map<string, Promise<PaymentMethodSummary>>
>();

/**
 * Completes a payment-method setup session, once per page: a checkout and a payment-method card
 * mounted together both see the customer come back, and the API is asked once. A completion that
 * failed is forgotten, so that asking again asks again.
 */
export function completePaymentMethodSessionOnce(
  client: KaitenSessionClientLike,
  sessionId: string,
): Promise<PaymentMethodSummary> {
  let done = completions.get(client);
  if (!done) completions.set(client, (done = new Map()));
  const known = done.get(sessionId);
  if (known) return known;
  const pending = client.completePaymentMethodSession(sessionId).then(
    ({ paymentMethod }) => paymentMethod,
    (error: unknown) => {
      done.delete(sessionId);
      throw error;
    },
  );
  done.set(sessionId, pending);
  return pending;
}

/**
 * Adds a payment method or replaces it: a hosted page of the provider's where the customer
 * saves a card, and the API checking with the provider that they did. `start()` opens the
 * page, and the return (the page is loaded again with `kaiten_setup_session`, or the popup
 * says it is done) completes the session and reads the portal again, which then holds the
 * new labels. Mount it on the page the customer is sent back to.
 *
 * Needs the first Kaiten release with billing (see STABILITY.md).
 */
export function usePaymentMethodSession(
  options: UsePaymentMethodSessionOptions = {},
): UsePaymentMethodSessionResult {
  useTrackHook("usePaymentMethodSession");

  const { sessionClient, scopeKey } = useKaitenContext();
  const { mutate } = useSWRConfig();
  const { opening = "redirect", currencyCode, returnUrl, navigate } = options;
  const [state, setState] = React.useState<
    Pick<UsePaymentMethodSessionResult, "status" | "paymentMethod" | "error">
  >({ status: "idle", paymentMethod: null, error: null });
  const sessionId = React.useRef<string | null>(null);
  const saved = React.useRef(options.onSaved);
  saved.current = options.onSaved;

  const complete = React.useCallback(
    async (id: string | null = sessionId.current) => {
      if (!sessionClient || id === null) return;
      sessionId.current = id;
      setState((previous) => ({ ...previous, status: "saving", error: null }));
      try {
        const paymentMethod = await completePaymentMethodSessionOnce(sessionClient, id);
        clearPending("payment-method");
        await invalidatePortal(mutate, scopeKey);
        setState({ status: "saved", paymentMethod, error: null });
        saved.current?.(paymentMethod);
      } catch (error) {
        setState((previous) => ({
          ...previous,
          status: "failed",
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      }
    },
    [sessionClient, mutate, scopeKey],
  );

  const start = React.useCallback(async () => {
    if (!sessionClient) {
      setState({
        status: "failed",
        paymentMethod: null,
        error: new Error(
          'usePaymentMethodSession is only available under mode="customer-session".',
        ),
      });
      return;
    }
    setState({ status: "opening", paymentMethod: null, error: null });
    try {
      const session = await sessionClient.createPaymentMethodSession({
        returnUrl: returnUrl ?? currentPageUrl(),
        ...(currencyCode ? { currencyCode } : {}),
      });
      sessionId.current = session.sessionId;
      const pending: PendingPaymentMethod = { sessionId: session.sessionId };
      savePending("payment-method", session.sessionId, pending, session.expiresAt);
      setState({ status: "awaiting", paymentMethod: null, error: null });
      if (opening === "popup") openSetupPage(session.url, navigate);
      else sendPageTo(session.url, navigate);
    } catch (error) {
      setState({
        status: "failed",
        paymentMethod: null,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [sessionClient, returnUrl, currencyCode, opening, navigate]);

  // The customer is back in this page: its address carries the session.
  useSetupReturn<{ "payment-method": PendingPaymentMethod }>({
    "payment-method": (id) => void complete(id),
  });

  // The customer is done in the popup beside this page.
  const awaiting = state.status === "awaiting" && opening === "popup";
  React.useEffect(() => {
    const id = sessionId.current;
    if (!awaiting || id === null) return;
    return waitForReturn(id, () => void complete(id));
  }, [awaiting, complete]);

  return { ...state, start, complete: () => complete() };
}
