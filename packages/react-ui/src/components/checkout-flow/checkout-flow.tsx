import * as React from "react";

import {
  useCheckout,
  useInvoiceSettlement,
  usePaymentMethodSession,
  type UseCheckoutResult,
} from "@kaitencloud/react/billing";
import {
  useLocalization,
  formatKaitenPrice,
  type Addon,
  type BillingPrice,
  type CheckoutSubscribed,
  type KaitenCheckoutWords,
  type Plan,
} from "@kaitencloud/react";
import { useKaitenDataContext, useTrackComponent } from "@kaitencloud/react/internal";

import { useIcons } from "../../appearance/icons.tsx";
import { useMergedAppearance } from "../../appearance/context.tsx";
import type { KaitenAppearance } from "../../appearance/types.ts";
import { cn } from "../../lib/utils.ts";
import { useAssertWrappedByKaitenProvider } from "../../style-root/kaiten-style-root.tsx";
import { Action, Message as FeedbackMessage } from "../shared/feedback.tsx";
import { useFocusScope } from "../shared/focus.ts";
import { KaitenBranding } from "../shared/kaiten-branding.tsx";
import { Badge } from "../ui/badge.tsx";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../ui/card.tsx";
import { Input } from "../ui/input.tsx";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group.tsx";
import { CheckoutSummaryBody, useProblemText } from "./checkout-summary.tsx";
import { useCheckoutWords } from "./words.ts";

type Words = KaitenCheckoutWords;

// ---------------------------------------------------------------------------
// What can be chosen
// ---------------------------------------------------------------------------

/** How many calendar months a billing period lasts: a quarter is 3, a year 12. */
const monthsOf = (price: BillingPrice) =>
  (price.interval === "year" ? 12 : 1) * (price.intervalCount ?? 1);

/**
 * The prices a customer can buy a plan at: the flat fees of its billing periods that the catalog
 * calls the default of their period, shortest first, and the one the host asks for if it is
 * another. A usage price is never bought on its own, and a fee with no amount cannot be named.
 */
function purchasablePrices(plan: Plan, chosen: string | undefined): BillingPrice[] {
  return (plan.billingPrices ?? [])
    .filter(
      (price) =>
        price.billingModel === "FLAT_FEE" &&
        price.amount !== undefined &&
        price.interval !== undefined &&
        (price.isDefault || price.id === chosen),
    )
    .sort((a, b) => monthsOf(a) - monthsOf(b));
}

/** The price a checkout starts at: the one asked for, else the monthly fee, else the shortest period. */
function initialPrice(prices: BillingPrice[], chosen: string | undefined): BillingPrice | null {
  return (
    prices.find((price) => price.id === chosen) ??
    prices.find((price) => monthsOf(price) === 1) ??
    prices[0] ??
    null
  );
}

/** What an add-on costs per unit, at the billing period and in the currency of the plan's price. */
function addonPrice(addon: Addon, plan: BillingPrice | null): BillingPrice | null {
  const fees = (addon.billingPrices ?? []).filter(
    (price) =>
      price.billingModel === "FLAT_FEE" &&
      price.amount !== undefined &&
      price.isDefault &&
      (plan === null || price.currencyCode === plan.currencyCode),
  );
  return (
    fees.find((price) => plan !== null && monthsOf(price) === monthsOf(plan)) ?? fees[0] ?? null
  );
}

// ---------------------------------------------------------------------------
// The component
// ---------------------------------------------------------------------------

export interface CheckoutFlowProps {
  /**
   * The plan to subscribe to: what `PricingTable` hands to `onSelectPlan`, or one of `usePlans()`.
   * It carries the prices that can be bought, so it has to be one the catalog served.
   */
  plan: Plan;
  /** The id of the price (the billing period) chosen at first: what `onSelectPlan` hands as its third argument. */
  priceId?: string;
  /**
   * The add-ons offered. Default: the public add-ons of the catalog that fit the plan, when
   * the provider reads one (a publishable key), in the currency of the price chosen.
   */
  addOns?: Addon[];
  /** The quantity of each add-on chosen at first, by slug. */
  initialQuantities?: Record<string, number>;
  /**
   * Where the provider's page sends the customer back to, with `kaiten_setup_session` appended:
   * an origin the publishable keys allow. Default: this page, minus its fragment and any
   * `kaiten_*` parameter. Mount the flow on that page: the checkout goes on from there.
   */
  returnUrl?: string;
  /** Where "already subscribed" sends the customer: the page of their portal. */
  portalHref?: string;
  /** What opens the portal, for a host that does not navigate to it. */
  onOpenPortal?: () => void;
  /** Called once, with the answer, when the instance is subscribed, whatever became of the payment. */
  onSubscribed?: (result: CheckoutSubscribed) => void;
  /** Adds a cancel button while the customer is choosing. */
  onCancel?: () => void;
  appearance?: KaitenAppearance;
  unstyled?: boolean;
}

/**
 * A customer's checkout of a plan, in the host's page: the billing period, the add-ons, a voucher
 * code, what is due today, the provider's page for a payment method and the way back from it, and
 * what became of the payment. Needs `mode="customer-session"`, and is `useCheckout`
 * of `@kaitencloud/react/billing`, drawn.
 *
 * No total is computed here. The server prices every choice (a checkout's `dryRun`) and the checkout
 * bills what was shown. A voucher code is typed once and leaves the page: it is not in the field
 * after "Apply", in the address, or anywhere a log could read it, and the server never says why it
 * refused one. A customer with no billing email is asked for one; with no payment method, sent to
 * the provider's page, in a popup or in place of the page, and brought back to go on. The
 * instance is subscribed whatever became of the payment: a card that was declined, a payment to
 * confirm, one not known yet, each is said, with what to do next.
 *
 * @experimental Styled component — shape may change in a minor release (see STABILITY.md); prefer `unstyled` mode or the headless hooks for the stable path.
 */
export function CheckoutFlow(props: CheckoutFlowProps) {
  useAssertWrappedByKaitenProvider("CheckoutFlow");
  useTrackComponent("CheckoutFlow");
  // A flow is one plan's: another plan is another checkout, from the start.
  return <CheckoutFlowView key={`${props.plan.slug}:${props.priceId ?? ""}`} {...props} />;
}

function CheckoutFlowView({
  plan,
  priceId,
  addOns,
  initialQuantities,
  returnUrl,
  portalHref,
  onOpenPortal,
  onSubscribed,
  onCancel,
  appearance,
  unstyled = false,
}: CheckoutFlowProps) {
  const merged = useMergedAppearance(appearance);
  const localization = useLocalization();
  const words = useCheckoutWords();
  const icons = useIcons();
  const problemText = useProblemText();
  const catalogAddOns = useKaitenDataContext().catalog.data?.addOns;
  // A code typed and not applied is not the checkout's: Subscribe waits for it to be applied or cleared.
  const [voucherPending, setVoucherPending] = React.useState(false);

  const prices = React.useMemo(() => purchasablePrices(plan, priceId), [plan, priceId]);
  const start = React.useMemo(() => initialPrice(prices, priceId), [prices, priceId]);
  const checkout = useCheckout({
    initial: { licensePriceId: start?.id ?? null, addOns: initialQuantities },
    returnUrl,
    onSubscribed,
  });

  // Whether the server has said that this customer gets no trial on the plan: it priced the selection
  // with the trial left in, and no trial came back, because one was already taken. Kept from one answer
  // to the next, so that the choice does not come back while a new selection is priced. Ticking
  // "without the trial" is no evidence of it: the server then prices no trial at all.
  const [trialTaken, setTrialTaken] = React.useState(false);
  const { preview } = checkout;
  const trialAnswer =
    preview.status === "ready" && !preview.isStale && preview.data && !checkout.selection.skipTrial
      ? preview.data.trialEndsAt === null
      : null;
  if (trialAnswer !== null && trialAnswer !== trialTaken) setTrialTaken(trialAnswer);

  // Each step replaces the last one's controls: the keyboard goes to what the new one says first, and
  // to the refusal of a checkout that sent the customer back to choosing.
  const scope = useFocusScope();
  const step = checkout.step;
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

  if (!checkout.available) return null;

  const chosen = prices.find((price) => price.id === checkout.selection.licensePriceId) ?? null;
  const offered = (
    addOns ??
    catalogAddOns?.filter(
      (addon) => !!addon.familySlug && plan.compatibleAddonFamilies?.includes(addon.familySlug),
    ) ??
    []
  ).filter((addon) => addonPrice(addon, chosen) !== null);

  const frame = (children: React.ReactNode, footer?: React.ReactNode) =>
    unstyled ? (
      <section ref={scope.ref} data-slot="checkout-flow" className="ktn-own">
        <h3>{plan.name}</h3>
        {children}
        {footer}
        <KaitenBranding unstyled />
      </section>
    ) : (
      <div ref={scope.ref} data-slot="checkout-flow" className="ktn-own w-[min(100%,36rem)]">
        <Card className={cn(merged.elements?.card)}>
          <CardHeader className={cn(merged.elements?.cardHeader)}>
            <CardTitle
              className={cn("flex flex-wrap items-center gap-2", merged.elements?.cardTitle)}
            >
              {plan.name}
              <Badge variant="secondary">{words.title}</Badge>
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

  if (prices.length === 0) {
    return frame(<Message unstyled={unstyled} tone="error" text={words.notSold} />);
  }

  if (checkout.step === "already_subscribed") {
    return frame(
      <>
        <Message unstyled={unstyled} tone="info" text={words.alreadySubscribed} focusKey="step" />
        {portalHref || onOpenPortal ? (
          <Action
            unstyled={unstyled}
            variant="default"
            href={portalHref}
            onClick={portalHref ? undefined : onOpenPortal}
          >
            {words.managePlan}
          </Action>
        ) : null}
      </>,
    );
  }

  if (checkout.step === "awaiting_payment_method") {
    return frame(
      <>
        <Message
          unstyled={unstyled}
          tone="info"
          text={words.awaitingPaymentMethod}
          focusKey="step"
        />
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
        <Action unstyled={unstyled} variant="default" onClick={() => void checkout.resume()}>
          {words.setupDone}
        </Action>
        {checkout.setup ? (
          <Action unstyled={unstyled} variant="outline" href={checkout.setup.url} external>
            {words.reopenSetup}
          </Action>
        ) : null}
        <Action unstyled={unstyled} variant="ghost" onClick={checkout.reset}>
          {words.cancel}
        </Action>
      </div>,
    );
  }

  if (checkout.step === "subscribed") {
    return frame(<Outcome checkout={checkout} unstyled={unstyled} />);
  }

  const submitting = checkout.step === "submitting";
  const LoaderIcon = icons.loader;
  const ArrowIcon = icons.arrowRight;
  const showTrialToggle =
    ((plan.trialPeriodDays ?? 0) > 0 && !trialTaken) || checkout.selection.skipTrial;
  const waitingForEmail = checkout.needsBillingEmail && checkout.preview.status === "idle";

  return frame(
    <>
      {prices.length > 1 ? (
        <PeriodChoice
          unstyled={unstyled}
          legend={localization.pricingTable.billingInterval}
          prices={prices}
          selected={checkout.selection.licensePriceId}
          disabled={submitting}
          onSelect={checkout.selectPrice}
          label={(price) =>
            formatKaitenPrice(price, localization, { entitlements: plan.entitlements }) ?? ""
          }
        />
      ) : null}

      {offered.length > 0 ? (
        <AddOnSteppers
          unstyled={unstyled}
          legend={localization.pricingTable.addOns}
          addOns={offered}
          chosen={chosen}
          quantities={checkout.selection.addOns}
          disabled={submitting}
          onChange={checkout.setAddOnQuantity}
          priceLabel={(price) => formatKaitenPrice(price, localization) ?? ""}
          words={words}
        />
      ) : null}

      <VoucherField
        unstyled={unstyled}
        state={checkout.preview.voucher}
        applied={checkout.selection.voucherCode !== ""}
        disabled={submitting}
        onApply={checkout.setVoucherCode}
        onPendingChange={setVoucherPending}
        words={words}
        checking={localization.states.loading}
      />

      {showTrialToggle ? (
        <label className={unstyled ? undefined : "flex items-center gap-2 text-sm"}>
          <input
            type="checkbox"
            checked={checkout.selection.skipTrial}
            disabled={submitting}
            onChange={(event) => checkout.setSkipTrial(event.target.checked)}
          />
          {words.skipTrial}
        </label>
      ) : null}

      {checkout.needsBillingEmail ? (
        <EmailField
          unstyled={unstyled}
          value={checkout.selection.billingEmail}
          disabled={submitting}
          invalid={checkout.problem?.kind === "billing_email_required"}
          onChange={checkout.setBillingEmail}
          words={words}
        />
      ) : null}

      {waitingForEmail ? (
        <Message unstyled={unstyled} tone="muted" text={words.billingEmailFirst} />
      ) : (
        <CheckoutSummaryBody preview={checkout.preview} unstyled={unstyled} />
      )}

      {checkout.error &&
      !(checkout.preview.voucher === "rejected" && checkout.problem?.kind === "voucher_invalid") ? (
        <Message
          unstyled={unstyled}
          tone="error"
          text={problemText(checkout.problem)}
          focusKey="error"
        />
      ) : null}
    </>,
    <>
      <p className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
        {words.paymentNote}
      </p>
      <div className={unstyled ? undefined : "flex gap-2"}>
        <Action
          unstyled={unstyled}
          variant="default"
          fill
          busy={submitting}
          disabled={!submitting && (!checkout.canSubmit || voucherPending)}
          onClick={() => void checkout.submit()}
        >
          {submitting ? (
            <>
              {unstyled ? null : <LoaderIcon className="size-4" />}
              {words.processing}
            </>
          ) : (
            <>
              {words.subscribe}
              {unstyled ? null : <ArrowIcon className="size-4" />}
            </>
          )}
        </Action>
        {onCancel ? (
          <Action unstyled={unstyled} variant="outline" disabled={submitting} onClick={onCancel}>
            {words.cancel}
          </Action>
        ) : null}
      </div>
    </>,
  );
}

// ---------------------------------------------------------------------------
// What became of the payment
// ---------------------------------------------------------------------------

function Outcome({ checkout, unstyled }: { checkout: UseCheckoutResult; unstyled: boolean }) {
  const words = useCheckoutWords();
  const { payment, result } = checkout;
  const [payClicked, setPayClicked] = React.useState(false);
  const method = usePaymentMethodSession({ opening: "popup" });
  // A declined card is paid on the provider's page: once the customer went there, the invoice is
  // waited on the way an open payment is.
  const failedSettlement = useInvoiceSettlement({
    invoiceId: result?.activationInvoice?.id ?? null,
    enabled: payment?.status === "failed" && (payClicked || method.status === "saved"),
  });
  if (!payment || !result) return null;

  const paid = payment.isPaid || failedSettlement.status === "paid";
  const url = payment.hostedInvoiceUrl;
  const trialEndsAt = result.subscription.trialEndsAt;

  if (paid) {
    return (
      <>
        <Message unstyled={unstyled} tone="success" text={words.subscribed} focusKey="step" />
        <Message
          unstyled={unstyled}
          tone="muted"
          text={
            payment.status === "not_required"
              ? trialEndsAt
                ? words.trialEndsOn(trialEndsAt)
                : words.nothingDue
              : words.paymentReceived
          }
        />
        {url && payment.status !== "not_required" ? (
          <Action unstyled={unstyled} variant="outline" href={url} external>
            {words.receipt}
          </Action>
        ) : null}
      </>
    );
  }

  const waiting =
    payment.settlement === "gave_up" ? words.paymentStillOpen : words.waitingForPayment;

  if (payment.status === "failed") {
    return (
      <>
        <Message unstyled={unstyled} tone="success" text={words.subscribed} focusKey="step" />
        <Message unstyled={unstyled} tone="error" text={words.paymentFailed} />
        {method.status === "saved" ? (
          <Message unstyled={unstyled} tone="success" text={words.paymentMethodUpdated} />
        ) : method.error ? (
          <Message unstyled={unstyled} tone="error" text={words.error} />
        ) : null}
        {payClicked || method.status === "saved" ? (
          <Message
            unstyled={unstyled}
            tone="muted"
            text={
              failedSettlement.status === "gave_up"
                ? words.paymentStillOpen
                : words.waitingForPayment
            }
          />
        ) : null}
        <div className={unstyled ? undefined : "flex flex-wrap gap-2"}>
          <Action
            unstyled={unstyled}
            variant={method.status === "saved" ? "outline" : "default"}
            disabled={method.status === "opening" || method.status === "saving"}
            onClick={() => void method.start()}
          >
            {words.updatePaymentMethod}
          </Action>
          {url ? (
            <Action
              unstyled={unstyled}
              variant={method.status === "saved" ? "default" : "outline"}
              href={url}
              external
              onClick={() => setPayClicked(true)}
            >
              {words.payInvoice}
            </Action>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <Message unstyled={unstyled} tone="success" text={words.subscribed} focusKey="step" />
      {payment.status === "requires_action" ? (
        <Message unstyled={unstyled} tone="info" text={words.confirmPayment} />
      ) : null}
      <Message
        unstyled={unstyled}
        tone="muted"
        text={waiting}
        busy={payment.settlement === "polling"}
      />
      {payment.status === "requires_action" && url ? (
        <Action unstyled={unstyled} variant="default" href={url} external>
          {words.completePayment}
        </Action>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// The pieces a flow is made of
// ---------------------------------------------------------------------------

/** A sentence of the checkout, found by its slot. */
function Message(props: Omit<React.ComponentProps<typeof FeedbackMessage>, "slot">) {
  return <FeedbackMessage slot="checkout-flow-message" {...props} />;
}

function PeriodChoice({
  unstyled,
  legend,
  prices,
  selected,
  disabled,
  onSelect,
  label,
}: {
  unstyled: boolean;
  legend: string;
  prices: BillingPrice[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  label: (price: BillingPrice) => string;
}) {
  const name = React.useId();
  const legendId = React.useId();
  return (
    <fieldset
      data-slot="checkout-flow-period"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
      disabled={disabled}
    >
      <legend id={legendId} className={unstyled ? undefined : "mb-2 text-sm font-medium"}>
        {legend}
      </legend>
      {/* Unstyled, the choices stay native radios, the markup that rendering promises;
          styled, they are drawn by the radio group the console's controls are made of. */}
      {unstyled ? (
        <div>
          {prices.map((price) => (
            <label key={price.id}>
              <input
                type="radio"
                name={name}
                checked={selected === price.id}
                onChange={() => onSelect(price.id)}
              />
              {label(price)}
            </label>
          ))}
        </div>
      ) : (
        <RadioGroup
          aria-labelledby={legendId}
          value={selected}
          onValueChange={(id: string) => onSelect(id)}
          disabled={disabled}
          className="flex flex-wrap gap-2"
        >
          {prices.map((price) => (
            <label
              key={price.id}
              className="group/field-label flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-data-checked:border-ktn-primary has-data-checked:ring-2 has-data-checked:ring-ktn-primary/20 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ktn-primary/50 has-disabled:cursor-not-allowed"
            >
              <RadioGroupItem value={price.id} />
              {label(price)}
            </label>
          ))}
        </RadioGroup>
      )}
    </fieldset>
  );
}

function AddOnSteppers({
  unstyled,
  legend,
  addOns,
  chosen,
  quantities,
  disabled,
  onChange,
  priceLabel,
  words,
}: {
  unstyled: boolean;
  legend: string;
  addOns: Addon[];
  chosen: BillingPrice | null;
  quantities: Record<string, number>;
  disabled: boolean;
  onChange: (slug: string, quantity: number) => void;
  priceLabel: (price: BillingPrice) => string;
  words: Words;
}) {
  return (
    <fieldset
      data-slot="checkout-flow-addons"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
      disabled={disabled}
    >
      <legend className={unstyled ? undefined : "mb-2 text-sm font-medium"}>{legend}</legend>
      <ul className={unstyled ? undefined : "flex flex-col gap-2"}>
        {addOns.map((addon) => {
          const quantity = quantities[addon.slug] ?? 0;
          const max = addon.maxQuantity ?? null;
          const price = addonPrice(addon, chosen);
          return (
            <li
              key={addon.slug}
              className={
                unstyled ? undefined : "flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
              }
            >
              <span className={unstyled ? undefined : "flex min-w-0 flex-col text-sm"}>
                <span className={unstyled ? undefined : "break-words"}>{addon.name}</span>
                {price ? (
                  <span className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
                    {priceLabel(price)}
                  </span>
                ) : null}
              </span>
              <span className={unstyled ? undefined : "flex items-center gap-2"}>
                <Action
                  unstyled={unstyled}
                  variant="outline"
                  label={words.decrease(addon.name)}
                  disabled={disabled}
                  busy={quantity <= 0}
                  onClick={() => onChange(addon.slug, quantity - 1)}
                >
                  −
                </Action>
                <output
                  aria-label={words.quantity(addon.name)}
                  className={unstyled ? undefined : "min-w-6 text-center font-mono text-sm"}
                >
                  {quantity}
                </output>
                <Action
                  unstyled={unstyled}
                  variant="outline"
                  label={words.increase(addon.name)}
                  disabled={disabled}
                  busy={max !== null && quantity >= max}
                  onClick={() => onChange(addon.slug, quantity + 1)}
                >
                  +
                </Action>
              </span>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/**
 * The field a voucher code is typed into. The code is the field's own for as long as it is
 * being typed, and the checkout's from "Apply" on: the field is emptied then, so that the code
 * is not left in the page for anything to read, and what is shown is that one was applied, or
 * that the code cannot be used, which is all the server ever says.
 */
function VoucherField({
  unstyled,
  state,
  applied,
  disabled,
  onApply,
  onPendingChange,
  words,
  checking,
}: {
  unstyled: boolean;
  state: "none" | "checking" | "applied" | "rejected";
  applied: boolean;
  disabled: boolean;
  onApply: (code: string) => void;
  /** Whether a code is typed in the field and not applied. */
  onPendingChange: (pending: boolean) => void;
  words: Words;
  /** What is said while the server is asked about the code. */
  checking: string;
}) {
  const [draft, setDraft] = React.useState("");
  const message = React.useId();
  // The field turns into a sentence and a button, and back: the keyboard follows it.
  const scope = useFocusScope();
  const previousState = React.useRef(state);
  React.useEffect(() => {
    if (previousState.current === state) return;
    previousState.current = state;
    scope.focus(state === "applied" || state === "checking" ? "voucher-status" : "voucher-input");
  }, [state, scope.focus]);
  const pending = draft.trim() !== "";
  React.useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  const apply = () => {
    const code = draft.trim();
    if (!code) return;
    onApply(code);
    setDraft("");
  };

  if (state === "applied" || state === "checking") {
    return (
      <div
        ref={scope.ref}
        data-slot="checkout-flow-voucher"
        className={cn(
          "ktn-own",
          unstyled ? undefined : "flex flex-wrap items-center justify-between gap-2",
        )}
      >
        <span
          role="status"
          data-focus="voucher-status"
          tabIndex={-1}
          className={unstyled ? undefined : "text-sm"}
        >
          {state === "checking" ? checking : words.voucherApplied}
        </span>
        <Action unstyled={unstyled} variant="ghost" disabled={disabled} onClick={() => onApply("")}>
          {words.voucherRemove}
        </Action>
      </div>
    );
  }

  const rejected = state === "rejected" && applied;
  return (
    <div
      ref={scope.ref}
      data-slot="checkout-flow-voucher"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
    >
      <label className={unstyled ? undefined : "text-sm font-medium"} htmlFor={`${message}-input`}>
        {words.voucherLabel}
      </label>
      <div className={unstyled ? undefined : "flex gap-2"}>
        {unstyled ? (
          <input
            id={`${message}-input`}
            data-focus="voucher-input"
            type="text"
            value={draft}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={rejected || undefined}
            aria-describedby={rejected ? message : pending ? `${message}-pending` : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
        ) : (
          <Input
            id={`${message}-input`}
            data-focus="voucher-input"
            type="text"
            value={draft}
            disabled={disabled}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-invalid={rejected || undefined}
            aria-describedby={rejected ? message : pending ? `${message}-pending` : undefined}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply();
              }
            }}
          />
        )}
        <Action
          unstyled={unstyled}
          variant="outline"
          disabled={disabled || draft.trim() === ""}
          onClick={apply}
        >
          {words.voucherApply}
        </Action>
      </div>
      {pending ? (
        <p
          id={`${message}-pending`}
          className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}
        >
          {words.voucherPending}
        </p>
      ) : null}
      {rejected ? (
        <div className={unstyled ? undefined : "flex flex-wrap items-center justify-between gap-2"}>
          <p
            id={message}
            role="alert"
            className={unstyled ? undefined : "text-sm text-destructive-subtle-foreground"}
          >
            {words.voucherInvalid}
          </p>
          <Action
            unstyled={unstyled}
            variant="ghost"
            disabled={disabled}
            onClick={() => onApply("")}
          >
            {words.voucherRemove}
          </Action>
        </div>
      ) : null}
    </div>
  );
}

function EmailField({
  unstyled,
  value,
  disabled,
  invalid,
  onChange,
  words,
}: {
  unstyled: boolean;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
  words: Words;
}) {
  const id = React.useId();
  const common = {
    id,
    type: "email" as const,
    value,
    disabled,
    required: true,
    autoComplete: "email",
    "aria-invalid": invalid || undefined,
    "aria-describedby": `${id}-hint`,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
  };
  return (
    <div
      data-slot="checkout-flow-email"
      className={cn("ktn-own", unstyled ? undefined : "flex flex-col gap-2")}
    >
      <label htmlFor={id} className={unstyled ? undefined : "text-sm font-medium"}>
        {words.billingEmail}
      </label>
      {unstyled ? <input {...common} /> : <Input {...common} />}
      <p id={`${id}-hint`} className={unstyled ? undefined : "text-xs text-ktn-muted-foreground"}>
        {words.billingEmailHint}
      </p>
    </div>
  );
}
