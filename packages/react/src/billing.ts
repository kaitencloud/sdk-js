"use client";

/**
 * `@kaitencloud/react/billing` — the headless hooks of a customer's billing.
 *
 * What a checkout, an invoice list and a customer portal do, under `mode="customer-session"`,
 * without a line of markup: the selection and what it costs, the provider's page for a
 * payment method and the return from it, the invoices of a payment that is still open, and
 * the changes a customer makes to their subscription. The server computes every amount, and
 * nothing here adds a price up.
 *
 * Its own entry rather than part of the root so that a host that gates its UI and offers no
 * checkout bundles none of it: `scripts/check-bundle-size.mjs` holds the root to that.
 * `@kaitencloud/react-ui`'s `CheckoutFlow` is these hooks, drawn.
 *
 * @experimental Until Kaiten billing ships (see STABILITY.md).
 */

export { isPlausibleEmail } from "./hooks/billing/checkout-selection.ts";
export type {
  CheckoutPreviewSelection,
  CheckoutSelection,
} from "./hooks/billing/checkout-selection.ts";
export type {
  AddonQuantityProblem,
  CheckoutAddonRefusal,
  CheckoutProblem,
} from "./hooks/billing/refusals.ts";
export {
  useCheckoutPreview,
  type CheckoutPreviewState,
  type CheckoutVoucherState,
} from "./hooks/billing/use-checkout-preview.ts";
export {
  useCheckout,
  type CheckoutPayment,
  type CheckoutSetup,
  type CheckoutStep,
  type UseCheckoutOptions,
  type UseCheckoutResult,
} from "./hooks/billing/use-checkout.ts";
export {
  useInvoices,
  useInvoiceSettlement,
  type InvoiceSettlement,
  type UseInvoiceSettlementOptions,
  type UseInvoicesOptions,
  type UseInvoicesResult,
} from "./hooks/billing/use-invoices.ts";
export {
  useBillingPortal,
  useCancelSubscription,
  usePaymentMethodSession,
  useReactivateSubscription,
  useSetAddonQuantity,
  useValidateVoucher,
  type UseBillingPortalOptions,
  type UseBillingPortalResult,
  type UsePaymentMethodSessionOptions,
  type UsePaymentMethodSessionResult,
  type UsePortalActionResult,
  type UseSetAddonQuantityResult,
} from "./hooks/billing/use-portal-actions.ts";
