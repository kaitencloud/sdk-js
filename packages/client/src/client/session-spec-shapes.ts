// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// The answers of the customer-session routes that the contract snapshot (`contracts/openapi.yaml`)
// does not carry yet: the redemption of a code on a live subscription, and the members the
// specification adds to the portal's vouchers. They are written here as the functional
// specification gives them, by hand, in this one file, so that the day the snapshot serves them the
// generated types replace these and nothing else changes. The test `tests/spec-shapes.test.ts`
// fails on that day, naming what to swap.
//
// The money and period words are the API's (`currency`, `billingPeriod`); `session-mapping.ts`
// maps them to the SDK's, as for every other answer.

import type * as Api from "../core/index.ts";

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

/** `GET /public/session/portal` with the vouchers as the specification gives them. */
export type WireSessionPortal = Omit<Api.SessionPortal, "vouchers"> & {
  vouchers: WireRedemption[];
};
