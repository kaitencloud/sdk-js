// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";

import {
  useAnonymousCheckout,
  isPlausibleEmail,
  type AnonymousCheckoutProblem,
  type AnonymousCheckoutQuote,
  type CheckoutPreviewState,
  type UseAnonymousCheckoutOptions,
  type UseAnonymousCheckoutResult,
} from "@kaitencloud/react/billing";
import {
  formatKaitenPrice,
  useLocalization,
  type BillingPrice,
  type KaitenAnonymousCheckoutWords,
  type KaitenLocalization,
  type Plan,
} from "@kaitencloud/react";
import { isHttpUrl, useKaitenDataContext, useTrackComponent } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { CheckoutSummaryBody } from "../checkout-flow/checkout-summary.tsx";
import { useCheckoutWords } from "../checkout-flow/words.ts";
import { Action, Message as FeedbackMessage } from "../shared/feedback.tsx";
import { useFocusScope } from "../shared/focus.ts";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { PeriodChoice } from "../shared/period-choice.tsx";
import { initialPrice, purchasablePrices } from "../shared/purchasable-prices.ts";
import { useBefore } from "../shared/use-before.ts";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { Skeleton } from "../ui/skeleton.tsx";
import { useAnonymousCheckoutWords } from "./words.ts";

/**
 * Whether the form asks for a field, and whether the visitor may leave it empty: `false` does not
 * ask, `"optional"` asks and takes an empty answer, and `"required"` (or `true`) asks and holds the
 * button until it is filled in.
 */
export type AnonymousCheckoutFieldMode = boolean | "optional" | "required";

type FieldKind = "off" | "optional" | "required";

/** A field's mode as the form reads it. A value a later release adds, which this one does not know, asks for nothing. */
function fieldKind(mode: AnonymousCheckoutFieldMode | undefined): FieldKind {
  if (mode === true || mode === "required") return "required";
  if (mode === "optional") return "optional";
  return "off";
}

export interface AnonymousCheckoutFlowProps {
  /**
   * The plan to sell: what `PricingTable` hands to `onSelectPlan`, or one of `usePlans()`. It carries
   * the prices that can be bought, so it has to be one the catalog served. Optional on the page a
   * visitor comes back to from the payment provider, which finds its plan from the session; without
   * a plan and with nothing to go on, nothing is drawn.
   */
  plan?: Plan;
  /** The id of the price (the billing period) chosen at first: what `onSelectPlan` hands as its third argument. */
  priceId?: string;
  /**
   * Where the payment provider's page sends the visitor back to, with `kaiten_checkout_session`
   * appended: https, or http on localhost, on an origin the publishable key allows, at most 2,048
   * characters. Default: this page, minus its fragment and any `kaiten_*` parameter (and its query
   * too when the address would be too long to send). Mount the flow on that page: the checkout goes
   * on from there.
   */
  returnUrl?: string;
  /**
   * Where "Continue" sends the visitor once the checkout completed: a page of the host's. Without
   * it, the visitor is told that the order is registered for their address, and nothing more:
   * Kaiten sends no e-mail to a vendor's buyers. A host whose own e-mail follows says so in
   * `localization.anonymousCheckout.completedFor`. An address that is not http(s) is not offered; any
   * http(s) address is, as written, so write it yourself: never from a request parameter of the page,
   * which would make the link an open redirect.
   */
  successUrl?: string;
  /**
   * Asks for the visitor's company too, above their name and e-mail, and hands it to `onStarted`
   * and `onSubscribed`. `true` and `"required"` hold the button until it is given, `"optional"`
   * takes an empty answer. Kaiten has no member for it, so it is never sent to Kaiten: the
   * vendor's backend names the customer after it. Default `false`.
   */
  collectCompany?: AnonymousCheckoutFieldMode;
  /**
   * Asks for the visitor's name too, and hands it to `onStarted` and `onSubscribed`. `true` and
   * `"required"` hold the button until it is given, `"optional"` takes an empty answer. Kaiten has
   * no member for it, so it is never sent to Kaiten. Default `false`.
   */
  collectName?: AnonymousCheckoutFieldMode;
  /**
   * Your own reference for the buyer, at most 255 characters. Echoed on the checkout's events.
   * Untrusted once it comes back through a browser: a visitor can change it, and a value taken from
   * a request parameter of your page is the visitor's too. Link a buyer to an account from the
   * signed `checkout_session.v1.completed` event your backend receives, never from this value read
   * in the browser.
   */
  clientReferenceId?: string;
  /** Called once when a checkout is started, with its id, before the visitor is sent anywhere. */
  onStarted?: UseAnonymousCheckoutOptions["onStarted"];
  /** Called once when the checkout completes, in this window, whether the visitor paid here or came back. */
  onSubscribed?: UseAnonymousCheckoutOptions["onSubscribed"];
  /** Adds a cancel button while the visitor is choosing, and beside the invoice of a card that was declined. */
  onCancel?: () => void;
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/**
 * A visitor's checkout of a plan, with no account, in the host's page: the billing period, an
 * email, the Turnstile security check, what is due as the server computed it, the payment
 * provider's page for a payment method and the way back from it, the payment, and what happens
 * next. Under a `mode="public"` or `mode="static"` provider given an `anonymousCheckoutClient`, and
 * `useAnonymousCheckout` of `@kaitencloud/react/billing`, drawn.
 *
 * It draws nothing unless the catalogue says the publishable key may start an anonymous
 * checkout, and starts nothing the visitor has not asked for: one start spends one Turnstile token,
 * so there is no preview on every change. No total is computed here. The start's `dueToday` is what
 * is shown and what is billed; if the confirm finds another amount, the visitor sees both before
 * they go on. A free plan starts with one button; a trial that needs no payment method, or a paid
 * plan, after a review. A visitor who comes back from the payment provider without the session's
 * token is told the checkout may have gone through, and is never started on another by the flow.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hook for the stable path.
 */
export function AnonymousCheckoutFlow(props: AnonymousCheckoutFlowProps) {
  useAssertWrappedByKaitenProvider("AnonymousCheckoutFlow");
  useTrackComponent("AnonymousCheckoutFlow");
  // A flow is one plan's: another plan is another checkout, from the start.
  return (
    <AnonymousCheckoutView key={`${props.plan?.slug ?? ""}:${props.priceId ?? ""}`} {...props} />
  );
}

/** The Turnstile theme that matches the page: the declared colour mode, else the host's `.dark`, else the system's. */
function turnstileTheme(baseTheme: KaitenAppearance["baseTheme"]): "auto" | "light" | "dark" {
  if (baseTheme === "dark" || baseTheme === "light") return baseTheme;
  if (baseTheme === undefined && typeof document !== "undefined") {
    return document.documentElement.closest(".dark") ? "dark" : "auto";
  }
  return "auto";
}

/** An address a link can safely go to: http(s), absolute or relative to this page. */
function safeHref(url: string | undefined): string | null {
  if (url === undefined || url === "") return null;
  try {
    const resolved = new URL(url, typeof window === "undefined" ? undefined : window.location.href);
    return isHttpUrl(resolved.href) ? url : null;
  } catch {
    return null;
  }
}

/**
 * True while the wait a refusal for coming too often asked for is not over: the visitor is not let
 * send the same call again before it. The wait starts when the refusal arrives, and a new refusal
 * starts it again.
 */
function useRateLimitWait(error: unknown, problem: AnonymousCheckoutProblem | null): boolean {
  const seconds =
    problem?.kind === "rate_limited" ? Math.max(1, Math.ceil(problem.retryAfterSeconds)) : null;
  const [until, setUntil] = React.useState<number | null>(null);
  React.useEffect(() => {
    setUntil(seconds === null ? null : Date.now() + seconds * 1000);
  }, [error, seconds]);
  return useBefore(until);
}

function AnonymousCheckoutView({
  plan,
  priceId,
  returnUrl,
  successUrl,
  collectCompany = false,
  collectName = false,
  clientReferenceId,
  onStarted,
  onSubscribed,
  onCancel,
  appearance,
  unstyled = false,
}: AnonymousCheckoutFlowProps) {
  const merged = useMergedAppearance(appearance);
  const localization = useLocalization();
  const checkoutWords = useCheckoutWords();
  const words = useAnonymousCheckoutWords();
  const icons = useIcons();
  const catalog = useKaitenDataContext().catalog;

  const ownPrices = React.useMemo(
    () => (plan ? purchasablePrices(plan, priceId) : []),
    [plan, priceId],
  );
  const start = React.useMemo(() => initialPrice(ownPrices, priceId), [ownPrices, priceId]);

  const checkout = useAnonymousCheckout({
    initial: { licensePriceId: start?.id ?? null },
    returnUrl,
    clientReferenceId,
    onStarted,
    onSubscribed,
    turnstile: { theme: turnstileTheme(merged.baseTheme) },
  });
  const { step, quote, session } = checkout;

  // The plan on screen: the host's, else the one the session names (a visitor who is back).
  const shown = React.useMemo(() => {
    if (plan) return plan;
    if (!session && !quote) return undefined;
    return catalog.data?.plans.find(
      (candidate) =>
        (session !== null && candidate.slug === session.licenseSlug) ||
        (session !== null &&
          candidate.billingPrices?.some((price) => price.id === session.priceId)),
    );
  }, [plan, session, quote, catalog.data]);
  const prices = React.useMemo(
    () => (plan ? ownPrices : shown ? purchasablePrices(shown, session?.priceId) : []),
    [plan, ownPrices, shown, session?.priceId],
  );
  const chosen = prices.find((price) => price.id === checkout.selection.licensePriceId) ?? null;
  const free = chosen !== null && chosen.amount === 0;

  const problemText = useProblemText(words);
  // A start or a confirm the API refused for coming too often is not sent again before the wait it gave.
  const limited = useRateLimitWait(checkout.error, checkout.problem);

  // What the visitor has been told is wrong with the form: after they leave the e-mail field, or
  // press the button while something is missing. Not while they are still typing it.
  const [emailLeft, setEmailLeft] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);
  const form = React.useRef<HTMLFormElement>(null);
  const formId = React.useId();

  // A free plan has nothing to review: starting it is confirming it, once.
  const confirmed = React.useRef<string | null>(null);
  const { confirm } = checkout;
  React.useEffect(() => {
    if (step !== "review" || !free || quote === null || confirmed.current === quote.sessionId)
      return;
    if (quote.requiresPaymentMethod || quote.dueToday.total !== 0 || quote.trialEndsAt !== null)
      return;
    if (checkout.error !== null || checkout.changed !== null) return;
    confirmed.current = quote.sessionId;
    void confirm();
  }, [step, free, quote, confirm, checkout.error, checkout.changed]);

  // Each step replaces the last one's controls: the keyboard goes to what the new one says first, and
  // to the refusal of an attempt that sent the visitor back.
  const scope = useFocusScope();
  const previousStep = React.useRef(step);
  React.useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    scope.focus("step", "error");
  }, [step, scope.focus]);
  const failed = checkout.error !== null;
  React.useEffect(() => {
    if (failed) scope.focus("error", "step");
  }, [failed, scope.focus]);

  const title = shown?.name ?? checkoutWords.title;
  const frame = (children: React.ReactNode, footer?: React.ReactNode) =>
    unstyled ? (
      <section ref={scope.ref} data-slot="anonymous-checkout-flow" className="ktn-own">
        <h3>{title}</h3>
        {children}
        {footer}
        <KaitenBranding unstyled />
      </section>
    ) : (
      <div
        ref={scope.ref}
        data-slot="anonymous-checkout-flow"
        className="ktn-own w-[min(100%,36rem)]"
      >
        <Card className={cn(merged.elements?.card)}>
          <CardHeader className={cn(merged.elements?.cardHeader)}>
            <CardTitle
              className={cn("flex flex-wrap items-center gap-2", merged.elements?.cardTitle)}
            >
              {title}
              <Badge variant="secondary">{checkoutWords.title}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className={cn("flex flex-col gap-5", merged.elements?.cardContent)}>
            {children}
          </CardContent>
          {footer ? (
            <CardFooter className="flex-col items-stretch gap-3">{footer}</CardFooter>
          ) : null}
          <KaitenBranding className="-mb-6" />
        </Card>
      </div>
    );

  const LoaderIcon = icons.loader;
  const ArrowIcon = icons.arrowRight;
  const busyLabel = (
    <>
      {unstyled ? null : <LoaderIcon className="size-4" />}
      {checkoutWords.processing}
    </>
  );

  // ---- Nothing to draw, or nothing yet ----------------------------------------

  if (step === "selecting" || step === "starting") {
    if (!checkout.available) {
      if (checkout.isLoading) return <Waiting unstyled={unstyled} frame={frame} />;
      return null;
    }
    if (!plan) return null;
  }

  // ---- Where the visitor is ---------------------------------------------------

  if (step === "completed") {
    const href = safeHref(successUrl);
    const receipt = session?.activationInvoice?.hostedInvoiceUrl ?? null;
    const email = session?.email ?? quote?.email ?? "";
    const paid = (quote?.dueToday.total ?? 0) > 0 && session?.trialEndsAt == null;
    return frame(
      <>
        <Message
          unstyled={unstyled}
          tone="success"
          text={checkoutWords.subscribed}
          focusKey="step"
        />
        <Message
          unstyled={unstyled}
          tone="muted"
          text={
            session?.trialEndsAt
              ? checkoutWords.trialEndsOn(session.trialEndsAt)
              : paid
                ? checkoutWords.paymentReceived
                : checkoutWords.nothingDue
          }
        />
        {session?.trialEndsAt && quote?.requiresPaymentMethod === false ? (
          <Message unstyled={unstyled} tone="muted" text={words.noCardTrial} />
        ) : null}
        {href === null && email ? (
          <Message unstyled={unstyled} tone="info" text={words.completedFor(email)} />
        ) : null}
        <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
          {href !== null ? (
            <Action unstyled={unstyled} variant="default" href={href}>
              {words.continueLink}
            </Action>
          ) : null}
          {receipt && paid ? (
            <Action unstyled={unstyled} variant="outline" href={receipt} external>
              {checkoutWords.receipt}
            </Action>
          ) : null}
        </div>
      </>,
    );
  }

  if (step === "closed") {
    return frame(
      <>
        <Message
          unstyled={unstyled}
          tone="info"
          text={
            checkout.closedAs === "ABANDONED"
              ? words.closedAbandoned
              : checkout.closedAs === "EXPIRED"
                ? words.closedExpired
                : words.sessionClosed
          }
          focusKey="step"
        />
        <Action unstyled={unstyled} variant="default" onClick={checkout.reset}>
          {words.startAgain}
        </Action>
      </>,
    );
  }

  if (step === "lost") {
    return frame(
      <>
        <Message unstyled={unstyled} tone="error" text={words.lost} focusKey="step" />
        <Message unstyled={unstyled} tone="muted" text={words.lostAdvice} />
        <Action unstyled={unstyled} variant="outline" onClick={checkout.reset}>
          {words.startNew}
        </Action>
      </>,
    );
  }

  if (step === "awaiting_payment") {
    return frame(<PaymentWait checkout={checkout} unstyled={unstyled} onCancel={onCancel} />);
  }

  // The visitor is on the payment provider's page: in the popup beside this one, or they were sent
  // away and have come back to it.
  if (step === "awaiting_payment_method" || (step === "confirming" && checkout.setup !== null)) {
    const confirming = step === "confirming";
    return frame(
      <>
        <Message
          unstyled={unstyled}
          tone="info"
          text={checkoutWords.awaitingPaymentMethod}
          focusKey="step"
        />
        {checkout.setupIncomplete ? (
          <Message unstyled={unstyled} tone="muted" text={checkoutWords.setupIncomplete} />
        ) : null}
        {checkout.error ? (
          <Message
            unstyled={unstyled}
            tone="error"
            text={problemText(checkout.problem)}
            focusKey="error"
          />
        ) : null}
      </>,
      <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
        <Action
          unstyled={unstyled}
          variant="default"
          busy={confirming || limited}
          onClick={() => void checkout.resume()}
        >
          {confirming ? busyLabel : checkoutWords.setupDone}
        </Action>
        {checkout.setup ? (
          <Action unstyled={unstyled} variant="outline" href={checkout.setup.url} external>
            {checkoutWords.reopenSetup}
          </Action>
        ) : null}
        <Action unstyled={unstyled} variant="ghost" disabled={confirming} onClick={checkout.reset}>
          {checkoutWords.cancel}
        </Action>
      </div>,
    );
  }

  // Back from the provider's page, nothing known yet.
  if (step === "confirming" && quote === null) {
    return <Waiting unstyled={unstyled} frame={frame} />;
  }

  if (step === "review" || step === "confirming") {
    return frame(
      <Review
        checkout={checkout}
        quote={quote!}
        unstyled={unstyled}
        words={words}
        problemText={problemText}
        price={
          quote?.trialEndsAt != null && quote.requiresPaymentMethod && chosen !== null
            ? (formatKaitenPrice(chosen, localization, { entitlements: shown?.entitlements }) ??
              null)
            : null
        }
        renewal={renewalOf(quote!, chosen, localization, shown?.entitlements)}
      />,
      <ReviewActions
        checkout={checkout}
        quote={quote!}
        unstyled={unstyled}
        words={words}
        busyLabel={busyLabel}
        limited={limited}
        onCancel={onCancel}
      />,
    );
  }

  // ---- Choosing -------------------------------------------------------------------

  if (!plan) return null;
  // Sold by contact, with or without a price on the page: say so and offer the way to ask. A plan
  // that has no price to buy and no way to ask is the one that cannot be bought online.
  const back = onCancel ? (
    <Action unstyled={unstyled} variant="outline" onClick={onCancel}>
      {checkoutWords.cancel}
    </Action>
  ) : null;
  if (plan.selfServe === false) {
    return frame(
      <>
        <Message unstyled={unstyled} tone="info" text={words.notSelfServe} />
        <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
          {safeHref(plan.selfServeCtaUrl ?? undefined) ? (
            <Action unstyled={unstyled} variant="default" href={plan.selfServeCtaUrl!}>
              {localization.pricingTable.contactUs}
            </Action>
          ) : null}
          {back}
        </div>
      </>,
    );
  }
  if (prices.length === 0) {
    return frame(
      <>
        <Message unstyled={unstyled} tone="error" text={checkoutWords.notSold} />
        {back}
      </>,
    );
  }

  const starting = step === "starting";
  const solved = checkout.turnstile.status === "solved";
  const emailTyped = checkout.selection.email.trim() !== "";
  const companyKind = fieldKind(collectCompany);
  const nameKind = fieldKind(collectName);
  const companyMissing = companyKind === "required" && checkout.selection.company.trim() === "";
  const nameMissing = nameKind === "required" && checkout.selection.name.trim() === "";
  const ready = checkout.canStart && !companyMissing && !nameMissing;
  const emailBad = !isPlausibleEmail(checkout.selection.email);
  const showEmailError = emailBad && (attempted || (emailLeft && emailTyped));
  const showCompanyError = companyMissing && attempted;
  const showNameError = nameMissing && attempted;
  // The first field the form draws carries the focus a new step sends the keyboard to.
  const firstField = companyKind !== "off" ? "company" : nameKind !== "off" ? "name" : "email";
  const submit = () => {
    if (limited) return;
    if (ready) {
      void checkout.start();
      return;
    }
    // Pressed while something is missing: say what, and take the visitor to the first field to fix.
    setAttempted(true);
    const firstWrong = companyMissing
      ? "company"
      : nameMissing
        ? "name"
        : emailBad
          ? "email"
          : null;
    if (firstWrong !== null) {
      form.current?.querySelector<HTMLElement>(`[data-field="${firstWrong}"]`)?.focus();
    }
  };

  // What the button waits for, said in words and tied to it: the keyboard and the screen reader reach
  // a button that is not available, and its name alone would not say why. Not said while the form
  // shows the same thing next to the field that has to change.
  const waitingFor =
    starting || ready
      ? null
      : !solved &&
          checkout.turnstile.status !== "failed" &&
          checkout.selection.licensePriceId !== null
        ? words.checkFirst
        : companyMissing
          ? showCompanyError
            ? null
            : words.companyRequired
          : nameMissing
            ? showNameError
              ? null
              : words.nameRequired
            : emailBad
              ? showEmailError
                ? null
                : words.emailFirst
              : null;
  const waitingId = `${formId}-waiting`;
  const checkId = `${formId}-check`;
  // A check that failed says why in its own sentence, and the button that waits on it points there.
  const describedBy =
    [
      waitingFor !== null ? waitingId : null,
      checkout.turnstile.status === "failed" ? checkId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return frame(
    <form
      ref={form}
      noValidate
      className={unstyled ? undefined : "flex flex-col gap-5"}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {prices.length > 1 ? (
        <PeriodChoice
          unstyled={unstyled}
          legend={localization.pricingTable.billingInterval}
          prices={prices}
          selected={checkout.selection.licensePriceId}
          disabled={starting}
          unavailable={NO_PRICES}
          note={null}
          onSelect={checkout.selectPrice}
          label={(price) =>
            formatKaitenPrice(price, localization, { entitlements: plan.entitlements }) ?? ""
          }
        />
      ) : null}

      {companyKind !== "off" ? (
        <Field
          unstyled={unstyled}
          slot="anonymous-checkout-company"
          label={words.companyLabel}
          hint={words.companyHint}
          optionalMark={companyKind === "optional" ? words.optional : undefined}
          type="text"
          autoComplete="organization"
          spellCheck={false}
          value={checkout.selection.company}
          disabled={starting}
          required={companyKind === "required"}
          invalid={showCompanyError}
          error={showCompanyError ? words.companyRequired : undefined}
          fieldName="company"
          focusKey={firstField === "company" ? "step" : undefined}
          onChange={checkout.setCompany}
        />
      ) : null}
      {nameKind !== "off" ? (
        <Field
          unstyled={unstyled}
          slot="anonymous-checkout-name"
          label={words.nameLabel}
          // Next to a company the field is ambiguous: the hint says it is the person, not the company.
          hint={companyKind !== "off" ? words.nameHint : undefined}
          optionalMark={nameKind === "optional" ? words.optional : undefined}
          type="text"
          autoComplete="name"
          autoCapitalize="words"
          spellCheck={false}
          value={checkout.selection.name}
          disabled={starting}
          required={nameKind === "required"}
          invalid={showNameError}
          error={showNameError ? words.nameRequired : undefined}
          fieldName="name"
          focusKey={firstField === "name" ? "step" : undefined}
          onChange={checkout.setName}
        />
      ) : null}
      <Field
        unstyled={unstyled}
        slot="anonymous-checkout-email"
        label={words.emailLabel}
        hint={words.emailHint}
        type="email"
        autoComplete="email"
        value={checkout.selection.email}
        disabled={starting}
        required
        invalid={showEmailError}
        error={showEmailError ? words.invalidEmail : undefined}
        fieldName="email"
        focusKey={firstField === "email" ? "step" : undefined}
        onBlur={() => setEmailLeft(true)}
        onChange={checkout.setEmail}
      />

      <TurnstileCheck
        checkout={checkout}
        unstyled={unstyled}
        words={words}
        messageId={checkId}
        refused={checkout.error !== null}
      />

      {checkout.problem ? (
        <Message
          unstyled={unstyled}
          tone="error"
          text={problemText(checkout.problem)}
          focusKey="error"
        />
      ) : null}
      {checkout.error && checkout.problem === null ? (
        <Message unstyled={unstyled} tone="error" text={checkoutWords.error} focusKey="error" />
      ) : null}

      {waitingFor !== null ? (
        <p id={waitingId} className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
          {waitingFor}
        </p>
      ) : null}

      <div className={unstyled ? undefined : "flex gap-2"}>
        {/* The form's own submit, for the Enter key: the visible button is the same action. */}
        <button type="submit" hidden />
        <Action
          unstyled={unstyled}
          variant="default"
          fill
          busy={starting || limited}
          unavailable={!starting && !limited && !ready}
          describedBy={describedBy}
          onClick={submit}
        >
          {starting ? (
            busyLabel
          ) : (
            <>
              {free ? words.startFree : words.continue}
              {unstyled ? null : <ArrowIcon className="size-4" />}
            </>
          )}
        </Action>
        {onCancel ? (
          <Action unstyled={unstyled} variant="outline" disabled={starting} onClick={onCancel}>
            {checkoutWords.cancel}
          </Action>
        ) : null}
      </div>
      {/* A trial that asks for no card is not a plan that sends the visitor to the provider: the note would contradict the review. */}
      {!free &&
      chosen !== null &&
      (plan.requiresPaymentMethod === true || !plan.trialPeriodDays) ? (
        <p className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
          {checkoutWords.paymentNote}
        </p>
      ) : null}
    </form>,
  );
}

const NO_PRICES: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------------------
// The pieces a flow is made of
// ---------------------------------------------------------------------------

/** A sentence of the checkout, found by its slot. */
function Message(props: Omit<React.ComponentProps<typeof FeedbackMessage>, "slot">) {
  return <FeedbackMessage slot="anonymous-checkout-message" {...props} />;
}

/** The flow while what it offers is read. */
function Waiting({
  unstyled,
  frame,
}: {
  unstyled: boolean;
  frame: (children: React.ReactNode) => React.ReactElement;
}) {
  const localization = useLocalization();
  return frame(
    unstyled ? (
      <p role="status" aria-busy="true">
        {localization.states.loading}
      </p>
    ) : (
      <div role="status" aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">{localization.states.loading}</span>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-6 w-1/2 self-end" />
      </div>
    ),
  );
}

/** What each refusal says. A kind a later `@kaitencloud/react` adds is the generic error, as `other` is. */
function useProblemText(
  words: KaitenAnonymousCheckoutWords,
): (problem: AnonymousCheckoutProblem | null) => string {
  const checkoutWords = useCheckoutWords();
  return React.useCallback(
    (problem) => {
      switch (problem?.kind) {
        case "turnstile_failed":
          return words.turnstileFailed;
        case "turnstile_unavailable":
          return `${words.turnstileUnavailable} ${words.tryAgainIn(problem.retryAfterSeconds)}`;
        case "rate_limited":
          return `${words.rateLimited} ${words.tryAgainIn(problem.retryAfterSeconds)}`;
        case "unavailable":
          // The wait is said once: the sentence that asks to try again is the wait's own when it is known.
          return problem.retryAfterSeconds === null
            ? checkoutWords.unavailable
            : `${words.providerUnavailable} ${words.tryAgainIn(problem.retryAfterSeconds)}`;
        case "not_available":
          return words.notAvailable;
        case "not_self_serve":
          return words.notSelfServe;
        case "plan_not_available":
          return words.planUnavailable;
        case "not_payable_online":
          return checkoutWords.notSold;
        case "addon_refused":
          return words.addonRefused;
        case "invalid_email":
          return words.invalidEmail;
        case "quota_reached":
          return words.quotaReached;
        case "session_closed":
          return words.sessionClosed;
        case "session_lost":
          return words.lost;
        case "due_today_changed":
          return words.dueTodayChanged;
        case "network":
          return words.network;
        default:
          return checkoutWords.error;
      }
    },
    [words, checkoutWords],
  );
}

function Field({
  unstyled,
  slot,
  label,
  hint,
  optionalMark,
  type,
  autoComplete,
  autoCapitalize,
  spellCheck,
  value,
  disabled,
  required,
  invalid,
  error,
  fieldName,
  focusKey,
  onBlur,
  onChange,
}: {
  unstyled: boolean;
  slot: string;
  label: string;
  hint?: string;
  /** The word that marks a field the visitor may leave empty, drawn after the label in parentheses. */
  optionalMark?: string;
  type: "text" | "email";
  autoComplete: string;
  /** Capitalises what is typed, for a field that holds a proper name. */
  autoCapitalize?: "words";
  /** Off for a field that holds a proper name, which a dictionary would underline. */
  spellCheck?: false;
  value: string;
  disabled: boolean;
  required?: boolean;
  invalid?: boolean;
  /** Why the input is invalid, in words: a colour alone says nothing to everyone. */
  error?: string;
  /** Names the input for the form, to take the keyboard to the first one that is wrong. */
  fieldName: string;
  /** Marks the input as somewhere focus can be sent to (see `useFocusScope`). */
  focusKey?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
}) {
  const id = React.useId();
  const common = {
    id,
    "data-focus": focusKey,
    "data-field": fieldName,
    type,
    value,
    disabled,
    required,
    autoComplete,
    autoCapitalize,
    spellCheck,
    "aria-invalid": invalid || undefined,
    "aria-describedby":
      [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") ||
      undefined,
    onBlur,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  };
  return (
    <div data-slot={slot} className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}>
      <label htmlFor={id} className={unstyled ? undefined : "text-sm font-medium"}>
        {label}
        {optionalMark ? (
          <span className={unstyled ? undefined : "font-normal text-ktn-muted-foreground"}>
            {" "}
            ({optionalMark})
          </span>
        ) : null}
      </label>
      {unstyled ? <input {...common} /> : <Input {...common} />}
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className={unstyled ? undefined : "text-xs text-destructive-subtle-foreground"}
        >
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** The security check: the widget Cloudflare draws, and a sentence that says where it stands. */
function TurnstileCheck({
  checkout,
  unstyled,
  words,
  messageId,
  refused,
}: {
  checkout: UseAnonymousCheckoutResult;
  unstyled: boolean;
  words: KaitenAnonymousCheckoutWords;
  /** The id of the sentence that says where the check stands, for the button to be described by. */
  messageId: string;
  /** Whether a refusal of the last attempt is on screen: the check is not said to have passed beside it. */
  refused: boolean;
}) {
  const { turnstile } = checkout;
  const legend = React.useId();
  const failed = turnstile.status === "failed";
  // The compact widget is taller than the normal one: its room is kept, or the form jumps when it
  // appears. A check that failed drew nothing, and keeps none: the message would float in a gap.
  const room = failed ? "" : turnstile.size === "compact" ? "min-h-[140px]" : "min-h-[65px]";
  // Two ways to fail: the script never loaded (a blocker, a firewall), or it loaded and the widget
  // reported an error, which carries a code. The advice for the first would be wrong for the second.
  // A check that passed is not said so beside a refusal of the attempt that used it: the visitor
  // has a fresh one in hand, and the refusal says what to do.
  const text = failed
    ? turnstile.errorCode !== null
      ? words.checkError
      : words.checkFailed
    : turnstile.status === "solved"
      ? refused
        ? ""
        : words.checked
      : words.checking;
  return (
    <div
      role="group"
      aria-labelledby={legend}
      data-slot="anonymous-checkout-check"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
    >
      <span id={legend} className={unstyled ? undefined : "text-sm font-medium"}>
        {words.humanCheck}
      </span>
      {/* The widget is Cloudflare's, in its own frame: this element only gives it a place and room. */}
      <div
        ref={turnstile.ref}
        data-slot="anonymous-checkout-turnstile"
        className={cn("ktn-own", unstyled ? undefined : cn(room, "max-w-full overflow-x-auto"))}
      />
      <p
        id={messageId}
        role={failed ? "alert" : "status"}
        aria-live="polite"
        className={
          unstyled
            ? undefined
            : cn(
                "text-xs",
                failed ? "text-destructive-subtle-foreground" : "text-ktn-muted-foreground",
              )
        }
      >
        {text}
      </p>
      {failed ? (
        <div>
          <Action unstyled={unstyled} variant="outline" size="sm" onClick={turnstile.retry}>
            {words.checkRetry}
          </Action>
        </div>
      ) : null}
    </div>
  );
}

/** What the server says is due, in the shape the summary draws. */
function previewOf(quote: AnonymousCheckoutQuote): CheckoutPreviewState {
  return {
    status: "ready",
    data: { status: "preview", dueToday: quote.dueToday, trialEndsAt: quote.trialEndsAt },
    isStale: false,
    voucher: "none",
    problem: null,
    error: null,
    retry: () => {},
  };
}

/**
 * What a paid plan renews at and when, for the review: the catalogue's price with its period, and the
 * day the period the server billed ends, from its base line. Nothing when the plan is free, starts
 * with a trial (the review says what follows it already) or the server named no period.
 */
function renewalOf(
  quote: AnonymousCheckoutQuote,
  chosen: BillingPrice | null,
  localization: KaitenLocalization,
  entitlements: Plan["entitlements"] | undefined,
): { price: string; isoDate: string } | null {
  if (chosen === null || quote.trialEndsAt !== null || quote.dueToday.total <= 0) return null;
  const base = quote.dueToday.lines.find((line) => line.type === "BASE");
  const price = formatKaitenPrice(chosen, localization, { entitlements });
  return base && price !== null ? { price, isoDate: base.serviceTo } : null;
}

/** The review of a started checkout: who it is for, what is due, and what changed since it was shown. */
function Review({
  checkout,
  quote,
  unstyled,
  words,
  problemText,
  price,
  renewal,
}: {
  checkout: UseAnonymousCheckoutResult;
  quote: AnonymousCheckoutQuote;
  unstyled: boolean;
  words: KaitenAnonymousCheckoutWords;
  problemText: (problem: AnonymousCheckoutProblem | null) => string;
  /** The catalogue price the plan is bought at, with its period, when a trial that asks for a card is on screen. */
  price: string | null;
  /** What a paid plan renews at and when, for the paid plan on screen. */
  renewal: { price: string; isoDate: string } | null;
}) {
  const localization = useLocalization();
  const { changed } = checkout;
  const stale = checkout.problem?.kind === "due_today_changed";
  const money = (amount: number, currency: string) => localization.formatMoney(amount, currency);
  return (
    <>
      <Message
        unstyled={unstyled}
        tone="muted"
        text={words.reviewFor(quote.email)}
        focusKey={changed ? undefined : "step"}
      />
      {changed ? (
        <Message
          unstyled={unstyled}
          tone="warning"
          focusKey="step"
          text={
            changed.previous.dueToday.total !== changed.current.dueToday.total ||
            changed.previous.dueToday.currencyCode !== changed.current.dueToday.currencyCode
              ? words.amountChanged(
                  money(changed.previous.dueToday.total, changed.previous.dueToday.currencyCode),
                  money(changed.current.dueToday.total, changed.current.dueToday.currencyCode),
                )
              : words.detailsChanged
          }
        />
      ) : null}
      {/* The amount changed after the payment method was saved and nothing was written: these figures are the ones the visitor was shown, not what is due now, and are not drawn as if they were. */}
      {stale ? null : (
        <>
          {quote.trialRefusedReason === "ALREADY_CONSUMED" ? (
            <Message unstyled={unstyled} tone="info" text={words.trialAlreadyUsed} />
          ) : null}
          <CheckoutSummaryBody preview={previewOf(quote)} unstyled={unstyled} lineDetail={false} />
          {renewal !== null ? (
            <Message
              unstyled={unstyled}
              tone="muted"
              text={words.renewsAt(renewal.price, renewal.isoDate)}
            />
          ) : null}
          {/* What the card is for: the server's `dueToday` has no line for a trial, the catalogue's price is the one said. */}
          {price !== null && quote.trialEndsAt !== null ? (
            <Message
              unstyled={unstyled}
              tone="muted"
              text={words.thenPrice(price, quote.trialEndsAt)}
            />
          ) : null}
          {quote.requiresPaymentMethod ? null : (
            <Message
              unstyled={unstyled}
              tone="muted"
              text={quote.trialEndsAt !== null ? words.noCardTrial : words.noCardNeeded}
            />
          )}
        </>
      )}
      {checkout.error ? (
        <Message
          unstyled={unstyled}
          tone="error"
          text={problemText(checkout.problem)}
          focusKey="error"
        />
      ) : null}
    </>
  );
}

function ReviewActions({
  checkout,
  quote,
  unstyled,
  words,
  busyLabel,
  limited,
  onCancel,
}: {
  checkout: UseAnonymousCheckoutResult;
  quote: AnonymousCheckoutQuote;
  unstyled: boolean;
  words: KaitenAnonymousCheckoutWords;
  busyLabel: React.ReactNode;
  /** The wait a refusal for coming too often asked for is not over. */
  limited: boolean;
  onCancel?: () => void;
}) {
  const checkoutWords = useCheckoutWords();
  const confirming = checkout.step === "confirming";
  const stale = checkout.problem?.kind === "due_today_changed";
  return (
    <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
      {stale ? (
        <Action unstyled={unstyled} variant="default" onClick={checkout.reset}>
          {words.startAgain}
        </Action>
      ) : (
        <>
          <Action
            unstyled={unstyled}
            variant="default"
            fill
            busy={confirming || limited}
            onClick={() => void checkout.confirm()}
          >
            {confirming
              ? busyLabel
              : quote.requiresPaymentMethod
                ? words.continueToPayment
                : quote.trialEndsAt !== null
                  ? words.startTrial
                  : words.startFree}
          </Action>
          <Action
            unstyled={unstyled}
            variant="outline"
            disabled={confirming}
            onClick={checkout.reset}
          >
            {words.change}
          </Action>
        </>
      )}
      {onCancel ? (
        <Action unstyled={unstyled} variant="ghost" disabled={confirming} onClick={onCancel}>
          {checkoutWords.cancel}
        </Action>
      ) : null}
    </div>
  );
}

/** The first payment being made: what the visitor may have to do, and what is waited for. */
function PaymentWait({
  checkout,
  unstyled,
  onCancel,
}: {
  checkout: UseAnonymousCheckoutResult;
  unstyled: boolean;
  onCancel?: () => void;
}) {
  const checkoutWords = useCheckoutWords();
  const { payment } = checkout;
  const url = payment?.hostedInvoiceUrl ?? null;
  const gaveUp = payment?.settlement === "gave_up";
  return (
    <>
      <Message
        unstyled={unstyled}
        tone={payment?.status === "failed" ? "error" : "info"}
        text={
          payment?.status === "failed" ? checkoutWords.cardDeclined : checkoutWords.startsOncePaid
        }
        focusKey="step"
      />
      {payment?.status === "requires_action" ? (
        <Message unstyled={unstyled} tone="info" text={checkoutWords.confirmPayment} />
      ) : null}
      {/* A refused card is waited on silently: the invoice link is the way on, and "waiting" would contradict it. */}
      {payment?.status === "failed" ? null : (
        <Message
          unstyled={unstyled}
          tone="muted"
          text={gaveUp ? checkoutWords.paymentStillOpen : checkoutWords.waitingForPayment}
          busy={payment?.settlement === "polling"}
        />
      )}
      {url && payment?.status === "requires_action" ? (
        <Action unstyled={unstyled} variant="default" href={url} external>
          {checkoutWords.completePayment}
        </Action>
      ) : null}
      {url && payment?.status === "failed" ? (
        <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
          <Action unstyled={unstyled} variant="default" href={url} external>
            {checkoutWords.payInvoice}
          </Action>
          {/* A way out of a checkout that the card did not pay. It is not a new start: the customer and its instance exist by now, and a second checkout would make others. */}
          {onCancel ? (
            <Action unstyled={unstyled} variant="outline" onClick={onCancel}>
              {checkoutWords.cancel}
            </Action>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
