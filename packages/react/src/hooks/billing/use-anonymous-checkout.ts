// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  CheckoutSessionClosedError,
  DueTodayChangedError,
  clearCheckoutReturn,
  readCheckoutReturn,
  type CheckoutConfirmation,
  type CheckoutDueToday,
  type CheckoutPaymentStatus,
  type CheckoutSession,
  type CheckoutSessionOpened,
  type CheckoutSessionPreview,
  type StartCheckoutInput,
  type TrialRefusedReason,
} from "@kaitencloud/client";

import { useKaitenContext, useKaitenDataContext } from "../../providers/kaiten-provider.tsx";
import { useTrackHook } from "../../telemetry/context.tsx";
import { isPlausibleEmail } from "./checkout-selection.ts";
import { anonymousCheckoutProblem, type AnonymousCheckoutProblem } from "./anonymous-refusals.ts";
import {
  announceReturn,
  clearKaitenParams,
  clearPending,
  currentPageUrl,
  openSetupPage,
  readPending,
  savePending,
  waitForReturn,
  type SetupPageOpening,
} from "./setup-return.ts";
import { useTurnstile, type TurnstileOptions, type TurnstileWidget } from "./use-turnstile.ts";

/**
 * Where an anonymous checkout stands:
 * - `selecting`: the visitor is choosing, giving an e-mail and passing the check;
 * - `starting`: the checkout is being started, and the server computes what is due;
 * - `review`: the checkout is started, and the visitor sees what is due before they confirm;
 * - `confirming`: the checkout is being confirmed;
 * - `awaiting_payment_method`: the visitor was sent to the payment provider's page to save a payment
 *   method, and the checkout goes on when they are back;
 * - `awaiting_payment`: the payment method is saved and the first payment is being made: the
 *   session is read until it settles;
 * - `completed`: the customer, the instance and the subscription exist;
 * - `closed`: the session is over without them: `closedAs` says whether it was abandoned or expired;
 * - `lost`: this browser holds no token for the session. It may have been paid for and completed.
 *
 * A minor release may add a step; keep a `default` branch (see STABILITY.md, "Unions that grow").
 */
export type AnonymousCheckoutStep =
  | "selecting"
  | "starting"
  | "review"
  | "confirming"
  | "awaiting_payment_method"
  | "awaiting_payment"
  | "completed"
  | "closed"
  | "lost";

/** What a visitor has chosen and typed. */
export interface AnonymousCheckoutSelection {
  /** The id of the price being bought (`BillingPrice.id`). `null` until one is chosen. */
  priceId: string | null;
  /**
   * A version of a public plan with `billingPeriod`, to name the price without its id: for a page
   * that knows its plans and does not read the catalogue. Read when `priceId` is `null`.
   */
  licenseSlug: string | null;
  billingPeriod: string | null;
  /** The add-ons wanted, by slug, with how many units of each. A quantity of 0 is none. */
  addOns: Record<string, number>;
  /** The voucher code the visitor typed, `""` for none. It goes in the body of the start and nowhere else. */
  voucherCode: string;
  /** `true` declines the plan's trial: the start sends `trial: false`. */
  skipTrial: boolean;
  /** The buyer's e-mail. It becomes the customer's billing e-mail once the checkout completes. */
  email: string;
  /**
   * The buyer's name, if the page asks for one. Kaiten has no member for it: it is never sent to
   * Kaiten. The hook keeps it for the page, which gets it in `onStarted` and `onComplete`.
   */
  name: string;
}

/** What the start computed, and the confirm may have changed: what a visitor is shown before they pay. */
export interface AnonymousCheckoutQuote {
  sessionId: string;
  email: string;
  /** What is billed today, the server's totals and the lines they come from. The SDK adds nothing up. */
  dueToday: CheckoutDueToday;
  /** The end of the trial the subscription starts with; `null` without one. */
  trialEndsAt: string | null;
  /** Why no trial is granted, when the plan has one: `"ALREADY_CONSUMED"` when this e-mail had it. */
  trialRefusedReason: TrialRefusedReason | null;
  /** Whether the visitor goes to the payment provider's page to save a payment method. */
  requiresPaymentMethod: boolean;
}

/** The payment provider's page where the visitor saves a payment method. */
export interface AnonymousCheckoutSetup {
  url: string;
  expiresAt: string;
  /**
   * How it was opened here: `popup` or `redirect`; `null` when this page was only loaded back, or
   * the page is not opened yet. A minor release may add a way, which the hook handles itself: take
   * one you do not know as `null`, with `url` to open the page again and `resume()` once the visitor
   * is back (STABILITY.md, "Unions that grow").
   */
  opening: SetupPageOpening | null;
}

/** An amount that changed between what the visitor saw and what the confirm found. */
export interface AnonymousCheckoutChange {
  /** What the visitor was shown. */
  previous: AnonymousCheckoutQuote;
  /** What it is now, the quote of the step. */
  current: AnonymousCheckoutQuote;
}

/** How paying the first invoice stands, in `awaiting_payment` and after. */
export interface AnonymousCheckoutPayment {
  /**
   * `processing` (not known yet), `requires_action` (the visitor must authorise it on
   * `hostedInvoiceUrl`), `failed` (the payment was refused: the same page lets them pay again),
   * `paid`, `not_required`. Open: more may come.
   */
  status: CheckoutPaymentStatus;
  hostedInvoiceUrl: string | null;
  /**
   * `polling` while the session is read on a schedule, `gave_up` when the schedule ran out first (the
   * session is then read once more each time the window takes focus), `idle` otherwise. A state a
   * minor release adds takes its case from another: take one you do not know as not settled.
   */
  settlement: "idle" | "polling" | "gave_up";
}

/** What `onComplete` is given: the checkout that completed. */
export interface AnonymousCheckoutOutcome {
  sessionId: string;
  /** The reference the page gave the start, echoed. Linking the buyer to an account is the vendor's, through the events. */
  clientReferenceId: string | null;
  /** The completed session: the e-mail, and the customer and instance slugs the completion created. */
  session: CheckoutSession;
  /** The name the visitor typed, kept in this tab since the start. `null` when none was typed or it was lost. */
  name: string | null;
}

export interface UseAnonymousCheckoutOptions {
  /** What the checkout starts with, from a pricing table for instance. */
  initial?: Partial<AnonymousCheckoutSelection>;
  /**
   * Where the payment provider's page sends the visitor back to, with `kaiten_checkout_session`
   * appended: https, or http on localhost, on an origin the publishable key allows. Default: this
   * page, minus its fragment and any `kaiten_*` parameter. Mount the hook on that page: the checkout
   * goes on from there.
   */
  returnUrl?: string;
  /** Your own reference for the buyer, at most 255 characters. Echoed on the checkout's events. */
  clientReferenceId?: string;
  /** How the Turnstile widget looks. */
  turnstile?: TurnstileOptions;
  /** What sends this page to the provider's, when the browser blocks the popup. Default `location.assign`. */
  navigate?: (url: string) => void;
  /** How often a payment that is being made is read, in milliseconds. Default 5000. */
  pollIntervalMs?: number;
  /** How long it is read before the hook gives up and waits for the window to take focus. Default 10 minutes. */
  giveUpAfterMs?: number;
  /**
   * Called once when a checkout is started, with its id, before the visitor is sent anywhere: the
   * place to record the name they typed against the session if the page keeps it.
   */
  onStarted?: (started: { sessionId: string; email: string; name: string | null }) => void;
  /** Called once when the checkout completes, in this window, whether the visitor paid here or came back. */
  onComplete?: (outcome: AnonymousCheckoutOutcome) => void;
}

export interface UseAnonymousCheckoutResult {
  /**
   * Whether a visitor can check out here: the provider was given an anonymous checkout client, and
   * the catalogue says the publishable key may start one, with the site key of its widget. A page
   * that is back from the payment provider goes on whether this is `true` or not.
   */
  available: boolean;
  /** `true` while the catalogue that says so is read. */
  isLoading: boolean;
  selection: AnonymousCheckoutSelection;
  select: (patch: Partial<AnonymousCheckoutSelection>) => void;
  /** Chooses the price (the plan, at a billing period) by its `BillingPrice.id`. */
  selectPrice: (priceId: string | null) => void;
  setEmail: (email: string) => void;
  setName: (name: string) => void;
  /** Sets the voucher code, `""` for none. */
  setVoucherCode: (code: string) => void;
  /** Sets how many units of an add-on are wanted; `0` is none. */
  setAddonQuantity: (addonSlug: string, quantity: number) => void;
  /** Declines the plan's trial, or takes it again. The styled `AnonymousCheckoutFlow` never calls it. */
  setSkipTrial: (skip: boolean) => void;
  step: AnonymousCheckoutStep;
  /** Whether {@link start} will start the checkout: a price, a plausible e-mail, and a Turnstile token in hand. */
  canStart: boolean;
  /**
   * Starts the checkout with the Turnstile token the widget gave, and the step becomes `review` with
   * what is due. One token, one start: the widget is reset for the next. Resolves to the quote, or
   * `null` when the start was refused (see `problem`).
   */
  start: () => Promise<AnonymousCheckoutQuote | null>;
  /**
   * Asks what the selection would bill, writing nothing (`dryRun`). It spends a Turnstile token like a
   * start does, so it is for a page that wants a price before it asks for an e-mail, never one to run
   * on every change. Resolves to the preview, or `null` when it was refused.
   */
  preview: () => Promise<CheckoutSessionPreview | null>;
  /** What the last {@link preview} computed for the current selection, `null` when none, or the selection moved. */
  previewed: CheckoutSessionPreview | null;
  /** What is due, in `review` and after. */
  quote: AnonymousCheckoutQuote | null;
  /** Set in `review` when the confirm found a different amount than the visitor was shown: they see both and decide. */
  changed: AnonymousCheckoutChange | null;
  /**
   * Confirms the checkout. A free plan, and a trial that needs no payment method, complete at once;
   * any other sends the visitor to the payment provider's page (a popup, or this page in its place)
   * and goes on when they come back. If the amount changed since the visitor saw it, the step stays
   * `review` with `changed`, and confirming again accepts the new amount.
   */
  confirm: () => Promise<void>;
  /**
   * Goes on after the visitor was on the payment provider's page: it happens by itself when the page
   * is loaded back, or the popup is done. Call it for one that was closed first.
   */
  resume: () => Promise<void>;
  /** The payment provider's page, while `awaiting_payment_method`. */
  setup: AnonymousCheckoutSetup | null;
  /** Whether the visitor says they are back and the provider has no payment method yet. */
  setupIncomplete: boolean;
  /** The session as last read, in `awaiting_payment` and after. */
  session: CheckoutSession | null;
  /** How the first payment stands, in `awaiting_payment`; `null` before. */
  payment: AnonymousCheckoutPayment | null;
  /** Reads the session once now, whatever the schedule says. */
  check: () => void;
  /** The checkout that completed, once it did. */
  outcome: AnonymousCheckoutOutcome | null;
  /** How the session ended, when `closed`: `ABANDONED` or `EXPIRED`. */
  closedAs: string | null;
  /**
   * What the last attempt was refused with, for a screen to word. `null` after a success. A
   * widget that could not load is not here but in `turnstile.status`.
   */
  problem: AnonymousCheckoutProblem | null;
  /** The error of the last attempt itself, with its status and code. */
  error: Error | null;
  /**
   * Starts over, with what was chosen kept and a fresh Turnstile token to be had: from `review`, from
   * the payment provider's page, from a session that `closed`, or one that is `lost`. It does nothing
   * while a call is in flight, while a payment is being made or once the checkout completed, since a
   * second checkout for a buyer who paid creates a second customer.
   */
  reset: () => void;
  /** The widget of the check the start needs: put `turnstile.ref` on the element it is drawn in. */
  turnstile: TurnstileWidget;
}

interface Flow {
  step: AnonymousCheckoutStep;
  sessionId: string | null;
  quote: AnonymousCheckoutQuote | null;
  changed: AnonymousCheckoutChange | null;
  setup: AnonymousCheckoutSetup | null;
  setupIncomplete: boolean;
  session: CheckoutSession | null;
  closedAs: string | null;
  outcome: AnonymousCheckoutOutcome | null;
  error: Error | null;
}

const SELECTING: Flow = {
  step: "selecting",
  sessionId: null,
  quote: null,
  changed: null,
  setup: null,
  setupIncomplete: false,
  session: null,
  closedAs: null,
  outcome: null,
  error: null,
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_GIVE_UP_AFTER_MS = 10 * 60_000;

const CLOSED: ReadonlySet<string> = new Set(["COMPLETED", "ABANDONED", "EXPIRED"]);

export function emptyAnonymousSelection(
  initial: Partial<AnonymousCheckoutSelection> = {},
): AnonymousCheckoutSelection {
  return {
    priceId: initial.priceId ?? null,
    licenseSlug: initial.licenseSlug ?? null,
    billingPeriod: initial.billingPeriod ?? null,
    addOns: { ...initial.addOns },
    voucherCode: initial.voucherCode ?? "",
    skipTrial: initial.skipTrial ?? false,
    email: initial.email ?? "",
    name: initial.name ?? "",
  };
}

/** Whether the selection names a price, by id or by plan and period. */
const namesPrice = (selection: AnonymousCheckoutSelection): boolean =>
  selection.priceId !== null ||
  (selection.licenseSlug !== null && selection.billingPeriod !== null);

/** The part of the request a selection is: the price, the add-ons, the code and the trial. */
function requestOf(
  selection: AnonymousCheckoutSelection,
): Omit<StartCheckoutInput, "turnstileToken"> {
  const addOns = Object.entries(selection.addOns)
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([addonSlug, quantity]) => ({ addonSlug, quantity }));
  const voucherCode = selection.voucherCode.trim();
  return {
    ...(selection.priceId !== null
      ? { priceId: selection.priceId }
      : { licenseSlug: selection.licenseSlug ?? "", billingPeriod: selection.billingPeriod ?? "" }),
    ...(addOns.length ? { addOns } : {}),
    ...(voucherCode ? { voucherCode } : {}),
    ...(selection.skipTrial ? { trial: false } : {}),
  };
}

/** What a quote is, of a session opened by the start or a session read. */
function quoteOf(
  source: CheckoutSessionOpened | CheckoutSession,
  email: string,
): AnonymousCheckoutQuote {
  return {
    sessionId: source.sessionId,
    email: "email" in source ? source.email : email,
    dueToday: source.dueToday,
    trialEndsAt: source.trialEndsAt,
    trialRefusedReason: source.trialRefusedReason,
    requiresPaymentMethod: source.requiresPaymentMethod,
  };
}

/** Whether what a visitor was shown is no longer what is due or when the trial ends. */
const differs = (shown: AnonymousCheckoutQuote, now: AnonymousCheckoutQuote): boolean =>
  shown.dueToday.total !== now.dueToday.total ||
  shown.dueToday.currencyCode !== now.dueToday.currencyCode ||
  shown.trialEndsAt !== now.trialEndsAt;

const asError = (thrown: unknown): Error =>
  thrown instanceof Error ? thrown : new Error(String(thrown));

/**
 * A visitor's checkout of a plan, with no account, from choosing it to having bought it, without a
 * line of markup: the selection and the e-mail, the Turnstile check, the start, what is due, the
 * payment provider's page for a payment method and the way back from it, and what became of the
 * payment.
 *
 * Nothing here adds a price up. The server computes `dueToday` at the start, a trial included, and
 * the checkout bills exactly that. A Turnstile token is single-use, so one start spends one, a
 * `preview` too; the hook never starts, or previews, by itself.
 *
 * The flow, for a plan that needs a payment method: `start()` makes the session and the visitor
 * reviews what is due; `confirm()` sends them to the provider's page, in a popup, or in place of
 * this page when popups are blocked; when they come back, to this page loaded with
 * `kaiten_checkout_session` or to the popup that says it is done, the checkout is confirmed again
 * and then the session is read until the payment settles. Mount the hook on the page they come back
 * to: `returnUrl` is this page by default. A free plan, and a trial that needs no payment method,
 * complete at the first `confirm()`.
 *
 * The session's token stays in the client, in memory and in the tab's `sessionStorage`, and is
 * never in a URL. A page that comes back without it is `lost`: the checkout may have been paid for
 * and completed, and the hook never starts another by itself.
 *
 * Needs `anonymousCheckoutClient` on a `mode="public"` or `mode="static"` provider and the first
 * Kaiten release with the anonymous checkout (see STABILITY.md).
 */
export function useAnonymousCheckout(
  options: UseAnonymousCheckoutOptions = {},
): UseAnonymousCheckoutResult {
  useTrackHook("useAnonymousCheckout");

  const { anonymousCheckoutClient: client } = useKaitenContext();
  const { catalog } = useKaitenDataContext();
  const capabilities = catalog.data?.capabilities;
  const siteKey =
    capabilities?.anonymousCheckout === true &&
    typeof capabilities.turnstileSiteKey === "string" &&
    capabilities.turnstileSiteKey !== ""
      ? capabilities.turnstileSiteKey
      : null;
  const available = client !== null && siteKey !== null;
  const isLoading = client !== null && catalog.isLoading && catalog.data === undefined;

  const [selection, setSelection] = React.useState(() => emptyAnonymousSelection(options.initial));
  const [flow, setFlow] = React.useState<Flow>(SELECTING);
  const [settlement, setSettlement] =
    React.useState<AnonymousCheckoutPayment["settlement"]>("idle");
  const [previewState, setPreviewState] = React.useState<{
    key: string;
    data: CheckoutSessionPreview;
  } | null>(null);
  // The checkout this page was loaded back to, read once so that every render sees the same.
  const [returned] = React.useState(() => readCheckoutReturn()?.sessionId ?? null);

  // The widget is drawn while a visitor can still start, and not otherwise.
  const turnstile = useTurnstile(
    flow.step === "selecting" && available ? siteKey : null,
    options.turnstile,
  );
  const { take: takeToken, reset: resetToken } = turnstile;
  const latest = React.useRef({ selection, flow, options, client, canStart: false });

  const select = React.useCallback(
    (patch: Partial<AnonymousCheckoutSelection>) =>
      setSelection((previous) => ({ ...previous, ...patch })),
    [],
  );
  const selectPrice = React.useCallback((priceId: string | null) => select({ priceId }), [select]);
  const setEmail = React.useCallback((email: string) => select({ email }), [select]);
  const setName = React.useCallback((name: string) => select({ name }), [select]);
  const setVoucherCode = React.useCallback(
    (voucherCode: string) => select({ voucherCode }),
    [select],
  );
  const setSkipTrial = React.useCallback((skipTrial: boolean) => select({ skipTrial }), [select]);
  const setAddonQuantity = React.useCallback(
    (addonSlug: string, quantity: number) =>
      setSelection((previous) => ({
        ...previous,
        addOns: { ...previous.addOns, [addonSlug]: quantity },
      })),
    [],
  );

  const canStart =
    client !== null &&
    available &&
    flow.step === "selecting" &&
    namesPrice(selection) &&
    isPlausibleEmail(selection.email) &&
    turnstile.status === "solved";
  latest.current = { selection, flow, options, client, canStart };

  // ---- What became of a session ------------------------------------------

  /** The session is over, or settled: the step it is in. */
  const settle = React.useCallback((session: CheckoutSession) => {
    if (session.status === "COMPLETED") {
      const kept = readPending<{ name?: string }>("anonymous-checkout", session.sessionId);
      clearPending("anonymous-checkout");
      const outcome: AnonymousCheckoutOutcome = {
        sessionId: session.sessionId,
        clientReferenceId: session.clientReferenceId,
        session,
        name: kept?.name ?? null,
      };
      setFlow((previous) => ({
        ...previous,
        step: "completed",
        sessionId: session.sessionId,
        quote: quoteOf(session, previous.quote?.email ?? ""),
        changed: null,
        setup: null,
        setupIncomplete: false,
        session,
        outcome,
        error: null,
      }));
      setSettlement("idle");
      return;
    }
    if (session.status === "ABANDONED" || session.status === "EXPIRED") {
      clearPending("anonymous-checkout");
      setFlow((previous) => ({
        ...previous,
        step: "closed",
        sessionId: session.sessionId,
        quote: quoteOf(session, previous.quote?.email ?? ""),
        changed: null,
        setup: null,
        setupIncomplete: false,
        session,
        closedAs: session.status,
        error: null,
      }));
      setSettlement("idle");
      return;
    }
    // Open, or a status a later Kaiten adds: the payment is still being made, and the session is read on.
    setFlow((previous) => ({
      ...previous,
      step: "awaiting_payment",
      sessionId: session.sessionId,
      quote: quoteOf(session, previous.quote?.email ?? ""),
      changed: null,
      setup: null,
      setupIncomplete: false,
      session,
      error: null,
    }));
  }, []);

  // The completion is told to the page once, whichever way the checkout got there.
  const told = React.useRef<string | null>(null);
  const outcome = flow.outcome;
  React.useEffect(() => {
    if (outcome === null || told.current === outcome.sessionId) return;
    told.current = outcome.sessionId;
    latest.current.options.onComplete?.(outcome);
  }, [outcome]);

  /** An error that ends where a step cannot go on: the step to show, and the error. */
  const refuse = React.useCallback(
    async (thrown: unknown, sessionId: string | null, back: Flow["step"]) => {
      const error = asError(thrown);
      const current = latest.current.client;
      const problem = anonymousCheckoutProblem(error);
      if (sessionId !== null && current !== null) {
        // A session that closed while the visitor was away, or whose amount changed: read it, to say how.
        if (error instanceof CheckoutSessionClosedError) {
          try {
            settle(await current.getCheckoutSession(sessionId));
            clearCheckoutReturn();
            return;
          } catch (readFailure) {
            return refuse(readFailure, null, back);
          }
        }
        if (error instanceof DueTodayChangedError) {
          try {
            const session = await current.getCheckoutSession(sessionId);
            setFlow((previous) => {
              const now = quoteOf(session, previous.quote?.email ?? "");
              return {
                ...previous,
                step: "review",
                sessionId,
                quote: now,
                changed:
                  previous.quote && differs(previous.quote, now)
                    ? { previous: previous.quote, current: now }
                    : null,
                session,
                error,
              };
            });
            return;
          } catch (readFailure) {
            return refuse(readFailure, null, back);
          }
        }
      }
      if (problem?.kind === "session_lost") {
        setFlow((previous) => ({ ...previous, step: "lost", sessionId, setup: null, error }));
        return;
      }
      setFlow((previous) => ({ ...previous, step: back, error }));
    },
    [settle],
  );

  // ---- The start ----------------------------------------------------------

  const start = React.useCallback(async (): Promise<AnonymousCheckoutQuote | null> => {
    const { selection: chosen, client: api, canStart: allowed, options: current } = latest.current;
    if (api === null || !allowed) return null;
    const token = takeToken();
    if (token === null) return null;
    const name = chosen.name.trim();
    setFlow({ ...SELECTING, step: "starting" });
    try {
      const opened = await api.startCheckout({
        ...requestOf(chosen),
        turnstileToken: token,
        dryRun: false,
        email: chosen.email.trim(),
        returnUrl: current.returnUrl ?? currentPageUrl(),
        ...(current.clientReferenceId ? { clientReferenceId: current.clientReferenceId } : {}),
      });
      const quote = quoteOf(opened, chosen.email.trim());
      if (name) savePending("anonymous-checkout", opened.sessionId, { name }, opened.expiresAt);
      setFlow({ ...SELECTING, step: "review", sessionId: opened.sessionId, quote });
      current.onStarted?.({
        sessionId: opened.sessionId,
        email: quote.email,
        name: name || null,
      });
      return quote;
    } catch (thrown) {
      // The token is spent whatever the refusal: the widget was reset when it was taken.
      setFlow({ ...SELECTING, error: asError(thrown) });
      return null;
    }
  }, [takeToken]);

  const preview = React.useCallback(async (): Promise<CheckoutSessionPreview | null> => {
    const { selection: chosen, client: api, flow: current } = latest.current;
    if (api === null || !available || current.step !== "selecting" || !namesPrice(chosen))
      return null;
    const token = takeToken();
    if (token === null) return null;
    const request = requestOf(chosen);
    const key = JSON.stringify(request);
    try {
      const email = chosen.email.trim();
      const data = await api.startCheckout({
        ...request,
        turnstileToken: token,
        ...(isPlausibleEmail(email) ? { email } : {}),
        dryRun: true,
      });
      setPreviewState({ key, data });
      setFlow((previous) => (previous.error ? { ...previous, error: null } : previous));
      return data;
    } catch (thrown) {
      setFlow((previous) => ({ ...previous, error: asError(thrown) }));
      return null;
    }
  }, [available, takeToken]);

  // ---- The confirm ----------------------------------------------------------

  /** What a confirm answered: where the checkout goes next. */
  const apply = React.useCallback(
    (
      confirmation: CheckoutConfirmation,
      shown: AnonymousCheckoutQuote | null,
      from: "review" | "awaiting_payment_method",
    ) => {
      const { options: current } = latest.current;
      if (confirmation.status === "completed") {
        settle(confirmation.session);
        return;
      }
      if (confirmation.status === "awaiting_payment") {
        settle(confirmation.session);
        return;
      }
      const now = quoteOf(confirmation.session, shown?.email ?? "");
      const next = { url: confirmation.setupUrl, expiresAt: confirmation.setupExpiresAt };
      if (from === "review" && shown && differs(shown, now)) {
        // The visitor sees the new amount before any payment method is captured.
        setFlow((previous) => ({
          ...previous,
          step: "review",
          quote: now,
          changed: { previous: shown, current: now },
          setup: null,
          session: confirmation.session,
          error: null,
        }));
        return;
      }
      if (from === "awaiting_payment_method") {
        // Back from the provider's page and no payment method was saved: nothing is opened for them.
        setFlow((previous) => ({
          ...previous,
          step: "awaiting_payment_method",
          quote: now,
          changed: null,
          setup: { ...next, opening: previous.setup?.opening ?? null },
          setupIncomplete: true,
          session: confirmation.session,
          error: null,
        }));
        return;
      }
      let opening: SetupPageOpening;
      try {
        opening = openSetupPage(next.url, current.navigate);
      } catch (thrown) {
        setFlow((previous) => ({ ...previous, step: "review", error: asError(thrown) }));
        return;
      }
      setFlow((previous) => ({
        ...previous,
        step: "awaiting_payment_method",
        quote: now,
        changed: null,
        setup: { ...next, opening },
        setupIncomplete: false,
        session: confirmation.session,
        error: null,
      }));
    },
    [settle],
  );

  const confirmSession = React.useCallback(
    async (sessionId: string, from: "review" | "awaiting_payment_method") => {
      const { client: api, flow: current } = latest.current;
      if (api === null) return;
      const shown = current.quote;
      setFlow((previous) => ({
        ...previous,
        step: "confirming",
        sessionId,
        changed: null,
        setupIncomplete: false,
        error: null,
      }));
      try {
        const confirmation = await api.confirmCheckout(sessionId);
        clearCheckoutReturn();
        apply(confirmation, shown, from);
      } catch (thrown) {
        await refuse(thrown, sessionId, from);
      }
    },
    [apply, refuse],
  );

  const confirm = React.useCallback(async () => {
    const { flow: current } = latest.current;
    if (current.step !== "review" || current.sessionId === null) return;
    // An amount that changed after the payment method was saved is not confirmed: nothing was charged.
    if (current.error instanceof DueTodayChangedError) return;
    await confirmSession(current.sessionId, "review");
  }, [confirmSession]);

  const resume = React.useCallback(async () => {
    const { flow: current } = latest.current;
    if (current.sessionId === null) return;
    if (current.step !== "awaiting_payment_method" && current.step !== "confirming") return;
    await confirmSession(current.sessionId, "awaiting_payment_method");
  }, [confirmSession]);

  // ---- Back from the provider's page --------------------------------------

  // This page was loaded with the checkout's session: the visitor is back. In the popup a page
  // opened beside its own, that page is waiting: it is told, it carries on, and this window closes.
  // In the page that was sent away, nothing waits: this page carries on.
  React.useEffect(() => {
    if (returned === null || client === null) return;
    let cancelled = false;
    void announceReturn(returned).then((handledElsewhere) => {
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
      void confirmSession(returned, "awaiting_payment_method");
    });
    return () => {
      cancelled = true;
    };
    // Once, for the session the page was loaded with.
  }, [returned, client, confirmSession]);

  // The visitor is done in the popup beside this page, which says so.
  const popupSession =
    flow.step === "awaiting_payment_method" && flow.setup?.opening === "popup"
      ? flow.sessionId
      : null;
  React.useEffect(() => {
    if (popupSession === null) return;
    return waitForReturn(popupSession, () => void resume());
  }, [popupSession, resume]);

  // ---- The payment --------------------------------------------------------

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const giveUpAfterMs = options.giveUpAfterMs ?? DEFAULT_GIVE_UP_AFTER_MS;
  const waitingOn = flow.step === "awaiting_payment" ? flow.sessionId : null;
  const reading = React.useRef(false);

  /** One read of the session being waited on. Resolves to whether the wait is over. */
  const read = React.useCallback(async (): Promise<boolean> => {
    const { client: api, flow: current } = latest.current;
    if (api === null || current.sessionId === null || reading.current) return false;
    reading.current = true;
    try {
      const session = await api.getCheckoutSession(current.sessionId);
      settle(session);
      return CLOSED.has(session.status);
    } catch (thrown) {
      const problem = anonymousCheckoutProblem(thrown);
      if (problem?.kind === "session_lost") {
        setFlow((previous) => ({ ...previous, step: "lost", setup: null, error: asError(thrown) }));
        return true;
      }
      // A read that fails is a read that found nothing: the next one tries again.
      return false;
    } finally {
      reading.current = false;
    }
  }, [settle]);

  React.useEffect(() => {
    if (waitingOn === null) {
      setSettlement("idle");
      return;
    }
    setSettlement("polling");
    const startedAt = Date.now();
    let stopped = false;
    void read();
    const timer = setInterval(() => {
      void read().then((over) => {
        if (stopped || over) {
          if (over) clearInterval(timer);
          return;
        }
        if (Date.now() - startedAt >= giveUpAfterMs) {
          clearInterval(timer);
          setSettlement((previous) => (previous === "polling" ? "gave_up" : previous));
        }
      });
    }, pollIntervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waitingOn, read, pollIntervalMs, giveUpAfterMs]);

  // Past the schedule, a visitor who comes back to the window probably just paid.
  React.useEffect(() => {
    if (settlement !== "gave_up") return;
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [settlement, read]);

  const check = React.useCallback(() => void read(), [read]);

  // ---- Starting over ---------------------------------------------------------

  const reset = React.useCallback(() => {
    const { flow: current, client: api } = latest.current;
    const resettable: Flow["step"][] = ["review", "awaiting_payment_method", "closed", "lost"];
    if (!resettable.includes(current.step)) return;
    // A session the visitor leaves is not read again: it is abandoned on the server's schedule.
    if (api !== null && current.sessionId !== null && current.step !== "lost") {
      api.forgetCheckoutSession(current.sessionId);
    }
    clearPending("anonymous-checkout");
    clearKaitenParams();
    setFlow(SELECTING);
    setSettlement("idle");
    resetToken();
  }, [resetToken]);

  // ---- The result ---------------------------------------------------------

  const session = flow.session;
  const payment: AnonymousCheckoutPayment | null =
    flow.step === "awaiting_payment" || flow.step === "completed"
      ? {
          status: session?.payment?.status ?? "processing",
          hostedInvoiceUrl: session?.payment?.hostedInvoiceUrl ?? null,
          settlement,
        }
      : null;
  const problem = flow.setupIncomplete ? null : anonymousCheckoutProblem(flow.error);
  const previewKey = JSON.stringify(requestOf(selection));
  const previewed = previewState?.key === previewKey ? previewState.data : null;

  return {
    available,
    isLoading,
    selection,
    select,
    selectPrice,
    setEmail,
    setName,
    setVoucherCode,
    setAddonQuantity,
    setSkipTrial,
    step: flow.step,
    canStart,
    start,
    preview,
    previewed,
    quote: flow.quote,
    changed: flow.changed,
    confirm,
    resume,
    setup: flow.setup,
    setupIncomplete: flow.setupIncomplete,
    session,
    payment,
    check,
    outcome: flow.outcome,
    closedAs: flow.closedAs,
    problem,
    error: flow.error,
    reset,
    turnstile: {
      siteKey: turnstile.siteKey,
      ref: turnstile.ref,
      status: turnstile.status,
      errorCode: turnstile.errorCode,
      retry: turnstile.retry,
    },
  };
}
