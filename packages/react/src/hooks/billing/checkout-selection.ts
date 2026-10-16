import type { CheckoutInput } from "@kaitencloud/client";

/**
 * What a customer has chosen to buy.
 *
 * It is all there is to a checkout from the customer's side: the server computes what
 * it costs from it, and the SDK never does.
 */
export interface CheckoutSelection {
  /**
   * The id of the price being bought (`BillingPrice.id`): a plan, at one billing period.
   * `null` until one is chosen, and nothing is previewed before that.
   */
  licensePriceId: string | null;
  /** The add-ons wanted, by slug, with how many units of each. A quantity of 0 is none. */
  addOns: Record<string, number>;
  /**
   * The voucher code the customer typed, `""` for none. It goes to the API in the body of
   * a checkout, and to nothing else: no URL, no log, no element.
   */
  voucherCode: string;
  /**
   * `true` subscribes without the plan's trial: the checkout sends `trial: false`. It is for a
   * host that draws its own checkout and offers that choice. The styled `CheckoutFlow` of
   * `@kaitencloud/react-ui` does not offer it: a plan with a trial is subscribed with it there.
   */
  skipTrial: boolean;
  /** Where invoices go. Needed only when the customer has none yet. */
  billingEmail: string;
}

/**
 * The part of a selection a preview depends on. The billing email does not change what is
 * due, and Kaiten prices a `dryRun` without one; an older Kaiten asks for it before it prices
 * anything for a customer that has none, and a preview then sends it.
 */
export type CheckoutPreviewSelection = Pick<
  CheckoutSelection,
  "licensePriceId" | "addOns" | "voucherCode" | "skipTrial" | "billingEmail"
>;

/** Whether a string can be an email address: one `@` with something on each side, and a dot after it. */
export const isPlausibleEmail = (value: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function emptyCheckoutSelection(
  initial: Partial<CheckoutSelection> = {},
): CheckoutSelection {
  return {
    licensePriceId: initial.licensePriceId ?? null,
    addOns: { ...initial.addOns },
    voucherCode: initial.voucherCode ?? "",
    skipTrial: initial.skipTrial ?? false,
    billingEmail: initial.billingEmail ?? "",
  };
}

/** The add-ons that are wanted, by slug, so that the same choice is always the same request. */
function wantedAddOns(
  selection: CheckoutPreviewSelection,
): { addonSlug: string; quantity: number }[] {
  return Object.entries(selection.addOns)
    .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([addonSlug, quantity]) => ({ addonSlug, quantity }));
}

/**
 * The checkout request a selection is, before anything is added to it for one call or
 * another. What the customer did not choose is left out of it: no add-ons, no code, and
 * no `trial` unless the trial is skipped, which is how the API reads the plan's own. An
 * email address that cannot be one is not sent: it would be refused, and say nothing the
 * customer's typing has not already said.
 */
export function checkoutInput(selection: CheckoutPreviewSelection): CheckoutInput {
  const addOns = wantedAddOns(selection);
  const voucherCode = selection.voucherCode.trim();
  const billingEmail = selection.billingEmail.trim();
  return {
    licensePriceId: selection.licensePriceId ?? "",
    ...(addOns.length ? { addOns } : {}),
    ...(voucherCode ? { voucherCode } : {}),
    ...(selection.skipTrial ? { trial: false } : {}),
    ...(isPlausibleEmail(billingEmail) ? { billingEmail } : {}),
  };
}

/**
 * An identity for a selection, to tell two requests apart without comparing them field by
 * field. Not a request and not a place for anything to read: it holds the voucher code,
 * so it stays in memory.
 */
export function selectionKey(selection: CheckoutPreviewSelection): string {
  return JSON.stringify(checkoutInput(selection));
}
