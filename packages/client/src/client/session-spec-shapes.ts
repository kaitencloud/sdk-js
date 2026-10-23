// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The answers of the customer-session routes that the contract snapshot (`contracts/openapi.yaml`)
// does not carry yet: the trial block of the portal and the redemption of a code on a live
// subscription. They are written here as the functional specification gives them (the portal
// payload and the public redemption), by hand, in this one file, so that the day the snapshot
// serves them the generated types replace these and nothing else changes. The test
// `tests/spec-shapes.test.ts` fails on that day, naming what to swap.
//
// The money and period words are the API's (`currency`, `billingPeriod`); `session-mapping.ts`
// maps them to the SDK's, as for every other answer.

import type * as Api from "../core/index.ts";

/** What the end of a trial charges, as the portal's trial block gives it. */
export interface WireTrialCharge {
  /** Minor units. */
  amount: number;
  currency: string;
  /** `MONTHLY`, `ANNUAL`, `QUARTERLY` or `SEMI_ANNUAL`. */
  billingPeriod?: string | null;
}

/** The trial block of `GET /public/session/portal`. Null outside a trial. */
export interface WireTrial {
  endsAt: string;
  reminderAt: string;
  /**
   * The charge at the end of the trial: the specification writes `charge { amount, currency,
   * billingPeriod }`. Two other documents of the same release write `chargeAmount { amount,
   * currency }`; the mapping reads either, so that the name the API settles on needs no change here.
   */
  charge?: WireTrialCharge | null;
  chargeAmount?: WireTrialCharge | null;
  paymentMethod?: { brand: string; last4: string } | null;
}

/**
 * A redemption of a code, as the portal lists it and as `vouchers/redeem` answers: the portal's
 * voucher, which the contract has, with the members the specification adds to it.
 */
export type WireRedemption = Omit<Api.PortalVoucher, "voucherType"> & {
  voucherType: string;
  appliesFromInvoice?: "next" | null;
  applicationsCount?: number;
  applicationsMax?: number | null;
};

/** `GET /public/session/portal` with the members the snapshot does not carry yet. */
export type WireSessionPortal = Omit<Api.SessionPortal, "vouchers"> & {
  vouchers: WireRedemption[];
  trial?: WireTrial | null;
};
