// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// Maps the answers of the `/public/checkout-sessions` routes onto the SDK's types.
// The amounts and totals are the server's, passed as they come.

import type * as Api from "../core/index.ts";
import { KaitenError } from "../core/runtime/errors.ts";
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
 * An answer whose status the client does not know, from a newer server. The unions
 * are closed, so it is refused rather than handed to the host outside its type, and
 * never with a token in it. The session, if there is one, can still be read.
 */
function unknownStatus(what: string, status: unknown, sessionId?: unknown): KaitenError {
  return new KaitenError({
    title: `Unknown ${what} status`,
    status: 0,
    detail:
      `Kaiten: the API answered a ${what} status this client does not know (${String(status)}). ` +
      (typeof sessionId === "string"
        ? `The session ${sessionId} exists: read it with getCheckoutSession to see where it stands.`
        : "Update @kaitencloud/client."),
  });
}

/**
 * The answer of `POST /public/checkout-sessions`. `token` is the session's `ksc_`
 * of an open session only; the client has already kept it when this runs.
 */
export function mapCheckoutSessionStart(raw: Api.CheckoutSessionStart): CheckoutSessionStart {
  switch (raw.status) {
    case "preview":
      return { status: "preview", ...mapQuote(raw) };
    case "open":
      return {
        status: "open",
        sessionId: raw.sessionId as string,
        token: raw.token as string,
        expiresAt: raw.expiresAt as string,
        ...mapQuote(raw),
      };
    default:
      throw unknownStatus("checkout start", raw.status, raw.sessionId);
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
      throw unknownStatus("checkout confirmation", raw.status, session.sessionId);
  }
}
