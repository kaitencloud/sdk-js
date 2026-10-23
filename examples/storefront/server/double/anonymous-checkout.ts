// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The anonymous checkout of the stand-in for Kaiten, the parts of it that keep no state: the body
// of a start, read the way the contract and the API read it, what the security check can come to,
// and a checkout session as the API shows it. The stand-in itself (`./kaiten-double.ts`) keeps the
// sessions, the customers they create and the money; this file is what it asks of them.

import { iso, problem } from "./responses.ts";

type Json = Record<string, any>;

/** The operation the start is named after in a refusal's `code`. */
export const START = "CreateCheckoutSession";
/** The operation the confirm is named after. */
export const CONFIRM = "ConfirmCheckoutSession";

/**
 * Cloudflare's published test site key that always passes, which the stand-in's catalogue hands the
 * page while the anonymous checkout is on. Its widget solves itself with no challenge, so a page
 * that loads Cloudflare's script draws a real widget and gets a token the stand-in accepts.
 */
export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";

/**
 * What the stand-in's verification of the security check comes to, as a test scripts it: the token
 * passes (Cloudflare says so), Cloudflare refuses it, Cloudflare cannot be reached from Kaiten, or
 * the publishable key has no Turnstile secret.
 */
export const TURNSTILE_VERDICTS = ["pass", "fail", "unavailable", "unconfigured"] as const;
export type TurnstileVerdict = (typeof TURNSTILE_VERDICTS)[number];

/** How long a session stays open, and how long a refused security check is asked to wait. */
export const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
export const TURNSTILE_RETRY_SECONDS = 30;

export type CheckoutStatus = "OPEN" | "AWAITING_PAYMENT" | "COMPLETED" | "ABANDONED" | "EXPIRED";

/** What the first invoice's payment comes to, as the session says it. */
export type SessionPayment = "paid" | "requires_action" | "failed" | "processing";

/** A checkout session the stand-in keeps. */
export interface StoredCheckout {
  id: string;
  /** The `ksc_` the start returned once. */
  token: string;
  status: CheckoutStatus;
  email: string;
  clientReferenceId: string | null;
  /** The plan and the price of the catalogue it sells. */
  plan: Json;
  price: Json;
  addOns: Array<{ addonSlug: string; quantity: number }>;
  /** What is due today, as the start priced it (or the confirm, if a trial was lost meanwhile). */
  due: Json;
  trialEndsAt: string | null;
  trialRefusedReason: string | null;
  requiresPaymentMethod: boolean;
  /** Where the provider's page brings the visitor back to, the session named in its query. */
  returnUrl: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
  customerSlug: string | null;
  instanceSlug: string | null;
  /** The provider's setup page, once the confirm opened one. */
  setupId: string | null;
  /** The ACTIVATION invoice of an amount due, once the completion issued it. The stand-in's own object: it moves when the invoice is paid. */
  invoice: Json | null;
  payment: SessionPayment | null;
}

/** The body of a start, once it is known to be one. */
export interface Draft {
  turnstileToken: string;
  priceId?: string;
  licenseSlug?: string;
  billingPeriod?: string;
  addOns: Array<{ addonSlug: string; quantity: number }>;
  voucherCode?: string;
  trial?: boolean;
  email?: string;
  returnUrl?: string;
  clientReferenceId?: string;
  dryRun: boolean;
}

/** The members of the body of a start, with the longest each string may be. The API refuses any other. */
const MEMBERS: Record<string, number | undefined> = {
  turnstileToken: 2048,
  priceId: undefined,
  licenseSlug: 255,
  billingPeriod: undefined,
  addOns: undefined,
  voucherCode: 64,
  trial: undefined,
  email: 254,
  returnUrl: 2048,
  clientReferenceId: 255,
  dryRun: undefined,
};

/** The characters of a string as the API counts them: code points. */
const characters = (value: string) => Array.from(value).length;

const invalid = (detail: string, errors: Array<{ location: string; message: string }>) =>
  problem(422, `${START}.InvalidBody`, detail, "/api/public/checkout-sessions", { errors });

/**
 * The body of a start as the contract's `CheckoutSessionDraft` has it: nothing but its members, the
 * Turnstile token present, strings that are not empty and not longer than they may be, booleans that
 * are booleans, add-ons of a slug and a quantity of 1 or more. Anything else is a 422, as the API
 * answers a body that does not fit its schema.
 */
export function readDraft(body: unknown): { draft: Draft } | { refusal: Response } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      refusal: invalid("the body is a JSON object", [
        { location: "body", message: "expected an object" },
      ]),
    };
  }
  const given = body as Json;
  const errors: Array<{ location: string; message: string }> = [];
  for (const name of Object.keys(given)) {
    if (!(name in MEMBERS)) {
      errors.push({ location: `body.${name}`, message: "unexpected property" });
    }
  }
  for (const [name, limit] of Object.entries(MEMBERS)) {
    const value = given[name];
    if (value === undefined) continue;
    if (name === "trial" || name === "dryRun") {
      if (typeof value !== "boolean")
        errors.push({ location: `body.${name}`, message: "expected a boolean" });
    } else if (name === "addOns") {
      const valid =
        Array.isArray(value) &&
        value.length <= 50 &&
        value.every(
          (each) =>
            typeof each === "object" &&
            each !== null &&
            typeof each.addonSlug === "string" &&
            (each.quantity === undefined ||
              (Number.isInteger(each.quantity) && each.quantity >= 1)),
        );
      if (!valid && value !== null) {
        errors.push({
          location: "body.addOns",
          message: "expected at most 50 add-ons of a slug and a quantity of 1 or more",
        });
      }
    } else if (typeof value !== "string" || value === "") {
      errors.push({ location: `body.${name}`, message: "expected a string that is not empty" });
    } else if (limit !== undefined && characters(value) > limit) {
      errors.push({ location: `body.${name}`, message: `expected at most ${limit} characters` });
    }
  }
  if (given.turnstileToken === undefined) {
    errors.push({
      location: "body.turnstileToken",
      message: "expected the token the widget gave the page",
    });
  }
  if (errors.length > 0) {
    return { refusal: invalid("the body does not fit the schema", errors) };
  }
  return {
    draft: {
      turnstileToken: given.turnstileToken,
      priceId: given.priceId,
      licenseSlug: given.licenseSlug,
      billingPeriod: given.billingPeriod,
      addOns: ((given.addOns ?? []) as Json[]).map((each) => ({
        addonSlug: each.addonSlug as string,
        quantity: (each.quantity ?? 1) as number,
      })),
      voucherCode: given.voucherCode,
      trial: given.trial,
      email: given.email,
      returnUrl: given.returnUrl,
      clientReferenceId: given.clientReferenceId,
      dryRun: given.dryRun === true,
    },
  };
}

/** An e-mail address as the API takes it: something before an `@`, a dotted host after it, 254 characters at most. */
export const isEmail = (value: string) =>
  characters(value) <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

/**
 * Whether a return page is one the API takes: https, or http on localhost, at most 2,048 characters, on
 * the origin of the page that asked (the stand-in knows no other origin to allow; a request that comes
 * from a backend, with no `Origin`, may name any).
 */
export function isReturnUrl(returnUrl: string, pageOrigin: string | null): boolean {
  if (characters(returnUrl) > 2048) return false;
  try {
    const target = new URL(returnUrl);
    const local = target.hostname === "localhost" || target.hostname === "127.0.0.1";
    const scheme = target.protocol === "https:" || (target.protocol === "http:" && local);
    return scheme && target.origin === (pageOrigin ?? target.origin);
  } catch {
    return false;
  }
}

/** The e-mail as the one-trial-per-address rule reads it: case and surrounding space do not matter. */
export const normalizedEmail = (email: string) => email.trim().toLowerCase();

/** The key of a trial an address consumed: the plan's family, because a trial is per family. */
export const trialKey = (email: string, familySlug: string) =>
  `${normalizedEmail(email)}|${familySlug}`;

/** The status a session reads: one still open past its expiry reads ABANDONED before anything marked it. */
export function readStatus(stored: StoredCheckout, now: number): CheckoutStatus {
  return stored.status === "OPEN" && Date.parse(stored.expiresAt) <= now
    ? "ABANDONED"
    : stored.status;
}

/** A session as `GET /public/checkout-sessions/{sessionId}` answers. */
export function sessionView(stored: StoredCheckout, now = Date.now()): Json {
  const invoice = stored.invoice;
  return {
    sessionId: stored.id,
    status: readStatus(stored, now),
    email: stored.email,
    clientReferenceId: stored.clientReferenceId,
    licenseSlug: stored.plan.licenseSlug,
    billingPeriod: stored.price.billingPeriod,
    priceId: stored.price.id,
    addOns: stored.addOns.map((each) => ({ addonSlug: each.addonSlug, quantity: each.quantity })),
    dueToday: structuredClone(stored.due),
    trialEndsAt: stored.trialEndsAt,
    trialRefusedReason: stored.trialRefusedReason,
    requiresPaymentMethod: stored.requiresPaymentMethod,
    expiresAt: stored.expiresAt,
    customerSlug: stored.customerSlug,
    instanceSlug: stored.instanceSlug,
    activationInvoice: invoice === null ? null : structuredClone(invoice),
    payment:
      invoice === null || stored.payment === null
        ? null
        : { status: stored.payment, hostedInvoiceUrl: invoice.hostedInvoiceUrl },
    createdAt: stored.createdAt,
    completedAt: stored.completedAt,
  };
}

/** The refusal of a session that cannot be confirmed any more, its status in `errors[0].value`. */
export const sessionClosed = (status: CheckoutStatus, path: string) =>
  problem(
    409,
    `${CONFIRM}.SessionClosed`,
    "this checkout session is closed: start a new one",
    path,
    {
      errors: [{ location: "path.sessionId", message: "the session's status", value: { status } }],
    },
  );

/** The licence a session sells, for the line an event tells the vendor. */
export const describeSession = (stored: StoredCheckout) =>
  `${stored.email}, ${stored.plan.name} ${String(stored.price.billingPeriod).toLowerCase()}`;

/** When a session that lapsed, in the past, would have expired: a moment ago. */
export const aMomentAgo = (now = Date.now()) => iso(now - 1000);
