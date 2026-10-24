// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { KaitenError } from "../core/runtime/errors.ts";
import type { KaitenSessionClientLike } from "../client/session-client.ts";
import type {
  CheckoutInput,
  CheckoutResult,
  CompletedPaymentMethodSession,
  KaitenPage,
  KaitenPortal,
  PaymentMethodSession,
  PaymentMethodSummary,
  PortalSession,
  PortalSubscription,
  SessionAddon,
  SessionInvoice,
  SessionInvoiceLine,
  SessionRedemption,
  VoucherSummary,
  VoucherValidation,
} from "../client/session-types.ts";
import type { BillingPrice } from "../client/types.ts";
import {
  DEMO_SESSION_NOW,
  DEMO_SETUP_EXPIRES_AT,
  demoCheckoutPrices,
  demoPortal,
  demoSessionInvoices,
  demoVouchers,
} from "./session-fixtures.ts";

export interface MockKaitenSessionClientOptions {
  /** The portal the session starts with. Defaults to `demoPortal()`. */
  portal?: KaitenPortal;
  /** The customer's invoices, newest first. Defaults to `demoSessionInvoices()`. */
  invoices?: SessionInvoice[];
  /** The prices a checkout can buy. Defaults to `demoCheckoutPrices()`. */
  prices?: BillingPrice[];
  /** The voucher codes it accepts, by upper-case code. Defaults to `demoVouchers()`. */
  vouchers?: Record<string, VoucherSummary>;
  /**
   * The add-ons the instance may hold, whatever it holds now. Defaults to the
   * ones the portal lists.
   */
  addOns?: SessionAddon[];
  /**
   * Decides what a checkout answers instead of the model below, for a scenario
   * it does not cover (add-ons, a trial, a payment that needs confirming). It
   * can throw a `KaitenError` to refuse. The double's state does not change.
   */
  checkout?: (
    input: CheckoutInput,
    portal: KaitenPortal,
  ) => CheckoutResult | Promise<CheckoutResult>;
  /**
   * Delay every call by this many milliseconds, so loading states are observable
   * instead of flashing past.
   */
  delayMs?: number;
  /** Reject every call with this error, to drive failure states. */
  error?: Error;
}

/** A call the double received: the method and its arguments. */
export interface MockSessionCall {
  method: keyof KaitenSessionClientLike;
  args: unknown[];
}

export interface MockKaitenSessionClient extends KaitenSessionClientLike {
  /** The live portal, including what its calls changed. */
  readonly portal: KaitenPortal;
  /** The live invoices, newest first. */
  readonly invoices: SessionInvoice[];
  /** Replaces the portal mid-scenario: a subscription lapsing, a payment method failing. */
  setPortal: (portal: KaitenPortal) => void;
  /** Replaces the invoices mid-scenario. */
  setInvoices: (invoices: SessionInvoice[]) => void;
  /** Every call, oldest first. */
  readonly calls: MockSessionCall[];
}

const refusal = (status: number, code: string, detail: string) =>
  new KaitenError({ title: detail, status, code, detail });

/** `months` calendar months after an instant, UTC. */
function addMonths(instant: string, months: number): string {
  const date = new Date(instant);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

/** How many calendar months a billing period of a price lasts. */
const monthsOf = (price: BillingPrice) =>
  (price.interval === "year" ? 12 : 1) * (price.intervalCount ?? 1);

/** A code as a voucher check reads it: case and separators do not matter. */
const normalizeCode = (code: string) => code.replace(/[^a-z0-9]/gi, "").toUpperCase();

/** What a `PRICE` voucher takes off a base fee, in minor units. */
function discountOn(subtotal: number, voucher: VoucherSummary | undefined): number {
  const discount = voucher?.discount;
  if (!discount) return 0;
  const value = Number(discount.value);
  const amount = discount.type === "PERCENTAGE" ? Math.round((subtotal * value) / 100) : value;
  return Math.min(Math.max(amount, 0), subtotal);
}

/**
 * A `KaitenSessionClient` backed by in-memory state instead of an API: a
 * customer portal and a checkout to build against, with no Kaiten account.
 * Anything typed `KaitenSessionClientLike` takes it.
 *
 * ```ts
 * import { createMockKaitenSessionClient } from "@kaitencloud/client/testing";
 *
 * const session = createMockKaitenSessionClient();
 * const portal = await session.getPortal();
 * await session.cancelSubscription();
 * ```
 *
 * It is a fake, not a stub: its calls change what the next read returns. A
 * cancellation ends the subscription with its period and takes the cancel
 * action away; a checkout of an unsubscribed instance subscribes it, after a
 * payment method has been saved if the customer has none, and puts the first
 * invoice at the head of the list; a quantity moves the add-on. A call the real
 * API would refuse is refused with the same status and code, a `KaitenError`.
 * Pass `checkout` to script a scenario its model does not cover.
 */
export function createMockKaitenSessionClient(
  options: MockKaitenSessionClientOptions = {},
): MockKaitenSessionClient {
  let portal = structuredClone(options.portal ?? demoPortal());
  let invoices = structuredClone(options.invoices ?? demoSessionInvoices());
  const prices = options.prices ?? demoCheckoutPrices();
  const vouchers = options.vouchers ?? demoVouchers();
  const addOns = structuredClone(options.addOns ?? portal.addOns);
  const calls: MockSessionCall[] = [];
  /** The vouchers the instance already holds, by name: a code is redeemed once per instance. */
  const held = new Set(portal.vouchers.map((voucher) => voucher.name));
  /** Payment method setup pages opened and not completed yet, by session id. */
  const setups = new Set<string>();
  let opened = 0;
  let issued = 0;

  async function enter<K extends keyof KaitenSessionClientLike>(method: K, args: unknown[]) {
    calls.push({ method, args });
    if (options.delayMs && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    if (options.error) throw options.error;
  }

  const open = (): PaymentMethodSession => {
    const sessionId = `cs_mock_${++opened}`;
    setups.add(sessionId);
    return {
      url: `https://pay.example.test/setup/${sessionId}`,
      sessionId,
      expiresAt: DEMO_SETUP_EXPIRES_AT,
    };
  };

  const savePaymentMethod = (): PaymentMethodSummary => {
    const saved: PaymentMethodSummary = {
      status: "ACTIVE",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
      attachedAt: DEMO_SESSION_NOW,
    };
    portal = { ...portal, paymentMethod: saved };
    return saved;
  };

  const touch = (change: Partial<KaitenPortal>) => {
    portal = { ...portal, ...change, updatedAt: DEMO_SESSION_NOW };
  };

  const liveSubscription = (): PortalSubscription | null =>
    portal.subscription && portal.subscription.status !== "CANCELED" ? portal.subscription : null;

  function changeSubscription(subscription: PortalSubscription, unsubscribe: boolean) {
    touch({
      subscription,
      capabilities: { ...portal.capabilities, unsubscribe },
    });
    return structuredClone(subscription);
  }

  async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (options.checkout) return structuredClone(await options.checkout(input, portal));
    if (liveSubscription()) {
      throw refusal(
        409,
        "CreateSessionCheckout.AlreadySubscribed",
        "this instance already has a live subscription; a plan change is made by the vendor",
      );
    }
    const price = prices.find((candidate) => candidate.id === input.licensePriceId);
    if (!price || price.billingModel !== "FLAT_FEE" || price.amount === undefined) {
      throw refusal(
        422,
        "CreateSessionCheckout.PriceNotPublic",
        "licensePriceId is not an ACTIVE flat-fee price of a plan in the public catalogue",
      );
    }
    if (input.addOns?.length) {
      throw new Error(
        "The session double does not model add-ons in a checkout: script the outcome with the `checkout` option.",
      );
    }
    const code = input.voucherCode === undefined ? undefined : normalizeCode(input.voucherCode);
    const voucher = code === undefined ? undefined : vouchers[code];
    if (code !== undefined && !voucher) {
      throw refusal(422, "CreateSessionCheckout.VoucherInvalid", "this voucher cannot be applied");
    }

    const periodEnd = addMonths(DEMO_SESSION_NOW, monthsOf(price));
    const discount = discountOn(price.amount, voucher);
    const total = price.amount - discount;
    const lines: SessionInvoiceLine[] = [
      {
        seq: 1,
        type: "BASE",
        label: price.label ?? "Plan",
        description: "",
        quantity: "1",
        unitAmountDecimal: price.unitAmountDecimal,
        amount: price.amount,
        serviceFrom: DEMO_SESSION_NOW,
        serviceTo: periodEnd,
      },
      ...(discount > 0
        ? [
            {
              seq: 2,
              type: "DISCOUNT",
              label: voucher?.name ?? "Discount",
              description: "",
              quantity: "1",
              unitAmountDecimal: null,
              amount: -discount,
              serviceFrom: DEMO_SESSION_NOW,
              serviceTo: periodEnd,
            },
          ]
        : []),
    ];

    if (input.dryRun) {
      return {
        status: "preview",
        dueToday: {
          currencyCode: price.currencyCode,
          subtotal: price.amount,
          discountTotal: discount,
          total,
          lines,
        },
        trialEndsAt: null,
      };
    }

    if (input.setupSessionId !== undefined) {
      if (!setups.delete(input.setupSessionId)) {
        throw refusal(
          409,
          "CreateSessionCheckout.SetupSessionIncomplete",
          "no payment method was saved on that setup page: send the customer back to it, or open a new one",
        );
      }
      savePaymentMethod();
    } else if (total > 0 && !portal.paymentMethod) {
      if (!input.returnUrl) {
        throw refusal(
          422,
          "CreateSessionCheckout.InvalidReturnUrl",
          "a payment method has to be saved first: send the returnUrl the setup page brings the customer back to",
        );
      }
      const page = open();
      return {
        status: "requires_payment_method",
        setupUrl: page.url,
        setupSessionId: page.sessionId,
        expiresAt: page.expiresAt,
      };
    }

    const subscription: PortalSubscription = {
      status: "ACTIVE",
      providerKind: total > 0 ? "STRIPE" : "NOOP",
      collectionMethod: total > 0 ? "CHARGE_AUTOMATICALLY" : "SEND_INVOICE",
      currencyCode: price.currencyCode,
      ...(price.interval ? { billingInterval: price.interval } : {}),
      ...(price.intervalCount ? { intervalCount: price.intervalCount } : {}),
      basePrice: structuredClone(price),
      currentPeriodStart: DEMO_SESSION_NOW,
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      scheduledChange: null,
    };
    const activation: SessionInvoice = {
      id: `inv_mock_${++issued}`,
      kind: "ACTIVATION",
      status: total > 0 ? "PAID" : "MANUAL",
      currencyCode: price.currencyCode,
      subtotal: price.amount,
      discountTotal: discount,
      total,
      issuedAt: DEMO_SESSION_NOW,
      dueAt: DEMO_SESSION_NOW,
      paidAt: total > 0 ? DEMO_SESSION_NOW : null,
      serviceFrom: DEMO_SESSION_NOW,
      serviceTo: periodEnd,
      providerInvoiceNumber: null,
      externalReference: null,
      hostedInvoiceUrl: total > 0 ? `https://pay.example.test/i/inv_mock_${issued}` : null,
      invoicePdfUrl: null,
      lines,
    };
    invoices = [activation, ...invoices];
    touch({
      subscription,
      capabilities: { ...portal.capabilities, unsubscribe: true, checkout: false },
    });
    return {
      status: "subscribed",
      subscription: structuredClone(subscription),
      activationInvoice: structuredClone(activation),
      payment: {
        status: total > 0 ? "paid" : "not_required",
        hostedInvoiceUrl: activation.hostedInvoiceUrl,
      },
    };
  }

  return {
    get portal() {
      return portal;
    },
    get invoices() {
      return invoices;
    },
    get calls() {
      return calls;
    },
    setPortal(next) {
      portal = structuredClone(next);
    },
    setInvoices(next) {
      invoices = structuredClone(next);
    },

    async getPortal(): Promise<KaitenPortal> {
      await enter("getPortal", []);
      return structuredClone(portal);
    },

    async listInvoices(
      listOptions: { cursor?: string; limit?: number } = {},
    ): Promise<KaitenPage<SessionInvoice>> {
      await enter("listInvoices", [listOptions]);
      // The cursor is opaque to a host; here it is the offset of the next row.
      const from = listOptions.cursor ? Number(listOptions.cursor) || 0 : 0;
      const size = Math.min(Math.max(listOptions.limit ?? 20, 1), 200);
      const items = structuredClone(invoices.slice(from, from + size));
      const next = from + size;
      return next < invoices.length
        ? { items, hasMore: true, nextCursor: `${next}` }
        : { items, hasMore: false };
    },

    async checkout(input: CheckoutInput): Promise<CheckoutResult> {
      await enter("checkout", [input]);
      return checkout(input);
    },

    async cancelSubscription(input: { reason?: string } = {}): Promise<PortalSubscription> {
      await enter("cancelSubscription", [input]);
      const subscription = liveSubscription();
      if (!subscription) {
        throw refusal(
          409,
          "CancelSessionSubscription.NotActive",
          "this instance has no subscription to cancel",
        );
      }
      return changeSubscription({ ...subscription, cancelAtPeriodEnd: true }, false);
    },

    async reactivateSubscription(): Promise<PortalSubscription> {
      await enter("reactivateSubscription", []);
      const subscription = liveSubscription();
      if (!subscription?.cancelAtPeriodEnd) {
        throw refusal(
          409,
          "ReactivateSessionSubscription.NotScheduledForCancellation",
          "this subscription is not ending",
        );
      }
      return changeSubscription({ ...subscription, cancelAtPeriodEnd: false }, true);
    },

    async createPortalSession(input: { returnUrl: string }): Promise<PortalSession> {
      await enter("createPortalSession", [input]);
      return { url: "https://billing.example.test/portal" };
    },

    async createPaymentMethodSession(input: {
      returnUrl: string;
      currencyCode?: string;
    }): Promise<PaymentMethodSession> {
      await enter("createPaymentMethodSession", [input]);
      if (!input.currencyCode && !liveSubscription()) {
        throw refusal(
          422,
          "CreateSessionPaymentMethodSession.CurrencyRequired",
          "the customer has no live subscription: send the currency to set the payment method up in",
        );
      }
      return open();
    },

    async completePaymentMethodSession(sessionId: string): Promise<CompletedPaymentMethodSession> {
      await enter("completePaymentMethodSession", [sessionId]);
      if (typeof sessionId !== "string" || sessionId === "") {
        throw new TypeError(
          "Kaiten: completePaymentMethodSession needs the sessionId createPaymentMethodSession gave.",
        );
      }
      if (!setups.delete(sessionId)) {
        throw refusal(
          409,
          "CompleteSessionPaymentMethodSession.SessionNotComplete",
          "no payment method was saved on that setup page",
        );
      }
      return { paymentMethod: structuredClone(savePaymentMethod()) };
    },

    async validateVoucher(input: {
      code: string;
      licensePriceId?: string;
    }): Promise<VoucherValidation> {
      await enter("validateVoucher", [input]);
      const voucher = vouchers[normalizeCode(input.code)];
      return voucher ? { valid: true, voucher: structuredClone(voucher) } : { valid: false };
    },

    async redeemVoucher(input: { code: string; dryRun?: boolean }): Promise<SessionRedemption> {
      await enter("redeemVoucher", [input]);
      if (typeof input?.code !== "string" || input.code.trim() === "") {
        throw new TypeError("Kaiten: redeemVoucher needs the code.");
      }
      if (portal.instance === null) {
        throw refusal(
          422,
          "RedeemSessionVoucher.InstanceRequired",
          "this session is bound to the customer only: a code is redeemed on an instance",
        );
      }
      const subscription = portal.subscription;
      if (subscription?.status === "INCOMPLETE") {
        throw refusal(
          409,
          "RedeemSessionVoucher.SubscriptionIncomplete",
          "the subscription is waiting for its first payment",
        );
      }
      if (!liveSubscription()) {
        throw refusal(
          409,
          "RedeemSessionVoucher.NoLiveSubscription",
          "there is no live subscription to redeem a code on",
        );
      }
      const voucher = vouchers[normalizeCode(input.code)];
      if (!voucher || held.has(voucher.name)) {
        // Whatever the reason, one answer: the server says none.
        throw refusal(422, "RedeemSessionVoucher.VoucherInvalid", "this code cannot be used");
      }
      const prices = voucher.voucherType === "PRICE" || voucher.voucherType === "COMPOSITE";
      const redemption: SessionRedemption = {
        name: voucher.name,
        voucherType: voucher.voucherType,
        status: "ACTIVE",
        appliesFromInvoice: prices ? "next" : null,
        applicationsCount: 0,
        applicationsMax: !prices
          ? null
          : voucher.duration === "ONE_TIME"
            ? 1
            : voucher.duration === "REPEATING"
              ? voucher.durationInPeriods
              : null,
        effectiveStartsAt: DEMO_SESSION_NOW,
        effectiveExpiresAt: null,
      };
      if (!input.dryRun) {
        held.add(voucher.name);
        // The next invoice carries the discount; during a trial that is the one the trial ends with.
        const { trial } = portal;
        touch({
          vouchers: [structuredClone(redemption), ...portal.vouchers],
          ...(trial?.charge && prices
            ? {
                trial: {
                  ...trial,
                  charge: {
                    ...trial.charge,
                    amount: trial.charge.amount - discountOn(trial.charge.amount, voucher),
                  },
                },
              }
            : {}),
        });
      }
      return structuredClone(redemption);
    },

    async setAddonQuantity(addonSlug: string, quantity: number): Promise<SessionAddon> {
      await enter("setAddonQuantity", [addonSlug, quantity]);
      if (typeof addonSlug !== "string" || addonSlug === "") {
        throw new TypeError("Kaiten: setAddonQuantity needs the slug of the add-on.");
      }
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new TypeError("Kaiten: setAddonQuantity needs a whole quantity, 0 or more.");
      }
      if (portal.instance === null) {
        throw refusal(
          422,
          "SetSessionAddonQuantity.InstanceRequired",
          "an add-on needs a bound instance",
        );
      }
      if (portal.subscription?.status === "INCOMPLETE") {
        throw refusal(
          409,
          "SetSessionAddonQuantity.SubscriptionIncomplete",
          "the checkout is waiting for payment",
        );
      }
      const addon = addOns.find((candidate) => candidate.slug === addonSlug);
      if (!addon) {
        throw refusal(
          422,
          "SetSessionAddonQuantity.AddonNotPublic",
          `"${addonSlug}" is not a public add-on that fits this plan`,
        );
      }
      if (addon.maxQuantity !== null && quantity > addon.maxQuantity) {
        throw refusal(
          422,
          "SetSessionAddonQuantity.QuantityExceedsMax",
          `at most ${addon.maxQuantity} of "${addonSlug}"`,
        );
      }
      const current = portal.addOns.find((candidate) => candidate.slug === addonSlug);
      // A subscription that is live has a boundary to wait for: a lower quantity, or none, is
      // scheduled for it and what the instance holds stays until then. Without one every change
      // applies at once, and an add-on set to none is gone from the portal and can be attached again.
      const status = portal.subscription?.status;
      const live = status === "TRIAL" || status === "ACTIVE" || status === "PAST_DUE";
      const base = current ?? addon;
      let held: SessionAddon;
      if (current && live && quantity < current.quantity) {
        held = { ...current, pendingQuantity: quantity };
      } else if (current && live && quantity === current.quantity) {
        held = { ...current, pendingQuantity: null };
      } else {
        held = { ...base, quantity, pendingQuantity: null };
      }
      const others = portal.addOns.filter((candidate) => candidate.slug !== addonSlug);
      touch({
        addOns:
          held.quantity === 0
            ? others
            : current
              ? portal.addOns.map((candidate) => (candidate.slug === addonSlug ? held : candidate))
              : [...others, held],
      });
      return structuredClone(held);
    },
  };
}
