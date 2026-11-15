// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import type { PaymentMethodSummary } from "@kaitencloud/react";

/** What the payment providers call their card brands, written as a customer knows them. */
const BRANDS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

/**
 * A payment method as its labels say it: "Visa •••• 4242", and "12/2030" when the provider gave
 * an expiry. The provider gives what it knows, and a label it does not give is left out rather
 * than made up. Never a number: the API does not carry one.
 */
export function describePaymentMethod(
  paymentMethod: PaymentMethodSummary,
  words: { card: string },
): { label: string; expiry: string | null } {
  const brand =
    paymentMethod.brand && paymentMethod.brand !== "unknown"
      ? (BRANDS[paymentMethod.brand] ??
        paymentMethod.brand.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()))
      : words.card;
  const label = paymentMethod.last4 ? `${brand} •••• ${paymentMethod.last4}` : brand;
  const expiry =
    paymentMethod.expMonth !== null && paymentMethod.expYear !== null
      ? `${String(paymentMethod.expMonth).padStart(2, "0")}/${paymentMethod.expYear}`
      : null;
  return { label, expiry };
}
