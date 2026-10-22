// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Maps the answers of the `/public/checkout-sessions` routes onto the SDK's types.
// The amounts and totals are the server's, passed as they come.

import type * as Api from "../core/index.ts";
import { billingInterval, list } from "./billing.ts";
import { mapDueToday, mapInvoice } from "./session-mapping.ts";
import type {
  CheckoutConfirmation,
  CheckoutSession,
  CheckoutSessionStart,
} from "./anonymous-checkout-types.ts";

/** The part of an answer that describes what the checkout bills. */
function mapQuote(raw: Api.CheckoutSessionStart | Api.CheckoutSession) {
  return {
    dueToday: mapDueToday(raw.dueToday),
    trialEndsAt: raw.trialEndsAt ?? null,
    trialRefusedReason: raw.trialRefusedReason ?? null,
    requiresPaymentMethod: raw.requiresPaymentMethod === true,
  };
}

/**
 * The answer of `POST /public/checkout-sessions`. The session token is not in the
 * result: the client keeps it, and this mapping does not read it.
 */
export function mapCheckoutSessionStart(raw: Api.CheckoutSessionStart): CheckoutSessionStart {
  switch (raw.status) {
    case "preview":
      return { status: "preview", ...mapQuote(raw) };
    case "open":
      return {
        status: "open",
        sessionId: raw.sessionId as string,
        expiresAt: raw.expiresAt as string,
        ...mapQuote(raw),
      };
    default:
      // A status this client does not know, from a newer server: handed to the
      // host as it came, which can at least read the status.
      return raw as unknown as CheckoutSessionStart;
  }
}

/** `GET /public/checkout-sessions/{sessionId}` as a `CheckoutSession`. */
export function mapCheckoutSession(raw: Api.CheckoutSession): CheckoutSession {
  const period = billingInterval(raw.billingPeriod);
  return {
    sessionId: raw.sessionId,
    status: raw.status,
    email: raw.email,
    clientReferenceId: raw.clientReferenceId ?? null,
    licenseSlug: raw.licenseSlug,
    billingPeriod: raw.billingPeriod,
    ...(period ? { billingInterval: period.interval } : {}),
    ...(period?.intervalCount ? { intervalCount: period.intervalCount } : {}),
    priceId: raw.priceId,
    addOns: list(raw.addOns).map((addOn) => ({
      addonSlug: addOn.addonSlug,
      quantity: addOn.quantity,
    })),
    ...mapQuote(raw),
    expiresAt: raw.expiresAt,
    customerSlug: raw.customerSlug ?? null,
    instanceSlug: raw.instanceSlug ?? null,
    activationInvoice: raw.activationInvoice ? mapInvoice(raw.activationInvoice) : null,
    payment: raw.payment
      ? { status: raw.payment.status, hostedInvoiceUrl: raw.payment.hostedInvoiceUrl ?? null }
      : null,
    createdAt: raw.createdAt,
    completedAt: raw.completedAt ?? null,
  };
}

/** `POST /public/checkout-sessions/{sessionId}/confirm` as a `CheckoutConfirmation`. */
export function mapCheckoutConfirmation(raw: Api.CheckoutConfirmation): CheckoutConfirmation {
  const session = mapCheckoutSession(raw.session);
  switch (raw.status) {
    case "requires_payment_method":
      return {
        status: "requires_payment_method",
        setupUrl: raw.setupUrl as string,
        setupExpiresAt: raw.setupExpiresAt as string,
        session,
      };
    case "awaiting_payment":
      return { status: "awaiting_payment", session };
    case "completed":
      return { status: "completed", session };
    default:
      // A status this client does not know, from a newer server: handed to the
      // host as it came, which can at least read the status.
      return { ...raw, session } as unknown as CheckoutConfirmation;
  }
}
