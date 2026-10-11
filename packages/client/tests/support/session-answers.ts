// The answers of the session routes as Kaiten serves them, typed by the
// contract: see fixtures/README.md. Each read gives a copy to change freely.

import { readFileSync } from "node:fs";

import type { KaitenApi } from "../../src/index.ts";
import type { WireCheckout } from "../../src/client/session-mapping.ts";
import { json } from "./session-harness.ts";

/** A refusal: its status, its problem, and the `Retry-After` it sent, in seconds. */
export interface Refusal {
  status: number;
  body: KaitenApi.Problem;
  retryAfter?: number;
}

interface Answers {
  addon: KaitenApi.SessionAddon;
  addonDetached: KaitenApi.SessionAddon;
  cancel: KaitenApi.SessionSubscription;
  paymentMethodCompleted: KaitenApi.CompletedPaymentMethodSession;
  paymentMethodCompletedBare: KaitenApi.CompletedPaymentMethodSession;
  paymentMethodSession: KaitenApi.PaymentMethodSession;
  portal: KaitenApi.SessionPortal;
  portalCanceling: KaitenApi.SessionPortal;
  portalCustomerWide: KaitenApi.SessionPortal;
  portalNeverSubscribed: KaitenApi.SessionPortal;
  portalPastDue: KaitenApi.SessionPortal;
  portalScheduledChange: KaitenApi.SessionPortal;
  portalSession: KaitenApi.PortalSession;
  reactivate: KaitenApi.SessionSubscription;
  voucherBoost: KaitenApi.SessionVoucherValidity;
  voucherFixed: KaitenApi.SessionVoucherValidity;
  voucherPercent: KaitenApi.SessionVoucherValidity;
  voucherRefused: KaitenApi.SessionVoucherValidity;
  checkoutPreview: Extract<WireCheckout, { status: "preview" }>;
  checkoutPreviewTrial: Extract<WireCheckout, { status: "preview" }>;
  checkoutRequiresMethod: Extract<WireCheckout, { status: "requires_payment_method" }>;
  checkoutSubscribed: Extract<WireCheckout, { status: "subscribed" }>;
  checkoutSubscribedAction: Extract<WireCheckout, { status: "subscribed" }>;
  checkoutSubscribedTrial: Extract<WireCheckout, { status: "subscribed" }>;
  invoicesEmpty: KaitenApi.PageSessionInvoice;
  invoicesFirstPage: KaitenApi.PageSessionInvoice;
  invoicesLastPage: KaitenApi.PageSessionInvoice;
  errors: Record<
    | "addonIncompatible"
    | "cancelBoundaryPending"
    | "cancelNotActive"
    | "checkoutAlreadySubscribed"
    | "checkoutProviderUnavailable"
    | "paymentMethodUnavailable"
    | "voucherRateLimited",
    Refusal
  >;
}

const ANSWERS = JSON.parse(
  readFileSync(new URL("../fixtures/session.initech.json", import.meta.url), "utf8"),
) as Answers;

export function answer<K extends Exclude<keyof Answers, "errors">>(key: K): Answers[K] {
  return structuredClone(ANSWERS[key]);
}

export function refusal(key: keyof Answers["errors"]): Refusal {
  return structuredClone(ANSWERS.errors[key]);
}

/** The response of a refusal, with the `Retry-After` it sent. */
export function refused(key: keyof Answers["errors"]): Response {
  const { status, body, retryAfter } = refusal(key);
  return json(body, status, retryAfter === undefined ? {} : { "Retry-After": `${retryAfter}` });
}
