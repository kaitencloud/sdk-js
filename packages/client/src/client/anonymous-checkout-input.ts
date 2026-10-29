// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The shape check of the body of `startCheckout`, shared by the client and by its
// double so that a page tested against the double fails where it would fail
// against the client.

import type { StartCheckoutInput } from "./anonymous-checkout-types.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The members of the body of a start. The API refuses any other. */
const MEMBERS: ReadonlySet<string> = new Set([
  "turnstileToken",
  "priceId",
  "licenseSlug",
  "billingPeriod",
  "addOns",
  "voucherCode",
  "trial",
  "email",
  "returnUrl",
  "clientReferenceId",
  "dryRun",
]);

/**
 * The members that are strings, not empty when sent, with the longest the API
 * takes. The API counts characters, so the check counts code points, not UTF-16
 * units: 255 emoji are 255 characters.
 */
const STRING_LIMITS: Readonly<Record<string, number | undefined>> = {
  turnstileToken: 2048,
  priceId: undefined,
  licenseSlug: 255,
  billingPeriod: undefined,
  voucherCode: 64,
  email: 254,
  returnUrl: 2048,
  clientReferenceId: 255,
};

const MAX_ADD_ONS = 50;

/** The number of characters of a string, as the API counts them: code points. */
function characters(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

/**
 * Refuses, before a Turnstile token is spent, a start the API would refuse for its
 * shape, with a `TypeError`: a member of the wrong type, too long or unknown, both
 * forms of the price, no e-mail or return URL on a real start. Everything but the
 * Turnstile token, which only the widget gives and a form has no say in: a page that
 * checks a start before it takes the token from the widget calls this, and
 * {@link startCheckoutBody} does the rest.
 *
 * The token is single-use, and a start that fails on the choice of the price has
 * already used it up.
 */
export function checkStartCheckoutInput(input: unknown): void {
  if (!isRecord(input)) {
    throw new TypeError("Kaiten: startCheckout needs an input object.");
  }
  for (const member of Object.keys(input)) {
    if (!MEMBERS.has(member) && input[member] !== undefined) {
      throw new TypeError(`Kaiten: startCheckout does not take "${member}".`);
    }
  }
  checkMembers(input as Partial<StartCheckoutInput>);
}

/**
 * The body of a start: {@link checkStartCheckoutInput}, and the Turnstile token the
 * widget gave. Returns the body to send, without the members left undefined.
 */
export function startCheckoutBody(input: StartCheckoutInput): Record<string, unknown> {
  checkStartCheckoutInput(input);
  if (typeof input.turnstileToken !== "string" || input.turnstileToken === "") {
    throw new TypeError("Kaiten: startCheckout needs the turnstileToken the widget gave the page.");
  }
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Record<string, unknown>;
}

function checkMembers(input: Partial<StartCheckoutInput>): void {
  for (const [field, limit] of Object.entries(STRING_LIMITS)) {
    const value = input[field as keyof StartCheckoutInput];
    if (value === undefined) continue;
    if (typeof value !== "string" || value === "") {
      throw new TypeError(`Kaiten: startCheckout ${field} must be a non-empty string.`);
    }
    if (limit !== undefined && characters(value) > limit) {
      throw new TypeError(`Kaiten: startCheckout ${field} is at most ${limit} characters.`);
    }
  }
  for (const field of ["trial", "dryRun"] as const) {
    if (input[field] !== undefined && typeof input[field] !== "boolean") {
      throw new TypeError(`Kaiten: startCheckout ${field} must be a boolean.`);
    }
  }
  const byPrice = input.priceId !== undefined;
  const byPlan = input.licenseSlug !== undefined || input.billingPeriod !== undefined;
  if (byPrice === byPlan || (byPlan && (!input.licenseSlug || !input.billingPeriod))) {
    throw new TypeError(
      "Kaiten: startCheckout needs priceId, or licenseSlug with billingPeriod, and not both.",
    );
  }
  if (input.dryRun !== true && (input.email === undefined || input.returnUrl === undefined)) {
    throw new TypeError("Kaiten: startCheckout needs email and returnUrl, unless it is a dryRun.");
  }
  if (input.addOns !== undefined) {
    const valid =
      Array.isArray(input.addOns) &&
      input.addOns.length <= MAX_ADD_ONS &&
      input.addOns.every(
        (addOn) =>
          isRecord(addOn) &&
          typeof addOn.addonSlug === "string" &&
          addOn.addonSlug !== "" &&
          Number.isInteger(addOn.quantity) &&
          addOn.quantity >= 1,
      );
    if (!valid) {
      throw new TypeError(
        `Kaiten: startCheckout addOns must be a list of at most ${MAX_ADD_ONS} { addonSlug, quantity }, with a whole quantity of 1 or more.`,
      );
    }
  }
}
