// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, expectTypeOf, test } from "vite-plus/test";

import {
  isKaitenWebhookOfType,
  KaitenWebhookVerificationError,
  verifyKaitenWebhook,
} from "../src/index.ts";
import type {
  InstanceBilling,
  KaitenWebhookEvent,
  KaitenWebhookType,
  OnInstanceBillingStatusChangedWebhookPayload,
  OnInstanceBillingTrialWillEndWebhookPayload,
  OnInstanceInvoiceHandoffAcknowledgedWebhookPayload,
  OnInstanceInvoiceIssuedWebhookPayload,
  OnVoucherExpiredWebhookPayload,
} from "../src/index.ts";

// The webhooks of the billing contract reach a consumer the way the others do:
// signed by Svix, relayed as `{ name, type, data }`, verified, then narrowed by
// their `type`. The union is derived from the contract, so these tests hold what
// the derivation must keep true however the contract grows: every event name
// names exactly one payload, and the payload of an event is the one its handler
// reads.

// ---- the shape of the union ----------------------------------------------------

type UnionToIntersection<U> = (U extends unknown ? (member: U) => void : never) extends (
  member: infer I,
) => void
  ? I
  : never;
type LastOf<U> =
  UnionToIntersection<U extends unknown ? () => U : never> extends () => infer Last ? Last : never;
type UnionToTuple<U, Acc extends unknown[] = []> = [U] extends [never]
  ? Acc
  : UnionToTuple<Exclude<U, LastOf<U>>, [LastOf<U>, ...Acc]>;

/** The names of events no payload of the union carries. */
type EventsWithoutPayload = {
  [T in KaitenWebhookType]: [Extract<KaitenWebhookEvent, { type: T }>] extends [never] ? T : never;
}[KaitenWebhookType];

describe("KaitenWebhookType", () => {
  test("names the 116 events of the contract, one payload each", () => {
    expectTypeOf<UnionToTuple<KaitenWebhookType>["length"]>().toEqualTypeOf<116>();
    expectTypeOf<UnionToTuple<KaitenWebhookEvent>["length"]>().toEqualTypeOf<116>();
  });

  test("is a union of literals, not a string a typo can slip through", () => {
    expectTypeOf<string>().not.toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.invoice.v1.issued">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.invoice.v1.isued">().not.toExtend<KaitenWebhookType>();
  });

  test("has a payload for every name", () => {
    expectTypeOf<EventsWithoutPayload>().toBeNever();
  });

  test("includes the billing events a consumer handles", () => {
    expectTypeOf<"com.kaiten.instance.invoice.v1.issued">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.invoice.v1.handoff_acknowledged">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.invoice.v1.paid">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.billing.v1.started">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.instance.billing.v1.trial_will_end">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.customer.payment_method.v1.expiring">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.publishable_key.v1.revoked">().toExtend<KaitenWebhookType>();
    expectTypeOf<"com.kaiten.voucher.v1.expired">().toExtend<KaitenWebhookType>();
  });

  test("narrows the event to the payload of one name", () => {
    expectTypeOf<
      Extract<KaitenWebhookEvent, { type: "com.kaiten.instance.invoice.v1.issued" }>
    >().toEqualTypeOf<OnInstanceInvoiceIssuedWebhookPayload>();
    expectTypeOf<
      Extract<KaitenWebhookEvent, { type: "com.kaiten.voucher.v1.expired" }>
    >().toEqualTypeOf<OnVoucherExpiredWebhookPayload>();
    expectTypeOf<
      Extract<KaitenWebhookEvent, { type: "com.kaiten.instance.billing.v1.trial_will_end" }>
    >().toEqualTypeOf<OnInstanceBillingTrialWillEndWebhookPayload>();
  });
});

describe("the statuses of a subscription", () => {
  type Status = InstanceBilling["status"];

  test("include INCOMPLETE, a checkout waiting for its first payment", () => {
    expectTypeOf<"INCOMPLETE">().toExtend<Status>();
    expectTypeOf<Status>().toEqualTypeOf<
      "INCOMPLETE" | "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELED"
    >();
  });

  test("are the ones a status change goes from and to", () => {
    type Change = OnInstanceBillingStatusChangedWebhookPayload["data"];
    expectTypeOf<Change["from"]>().toEqualTypeOf<Status>();
    expectTypeOf<Change["to"]>().toEqualTypeOf<Status>();
  });
});

// ---- a relayed billing event ---------------------------------------------------

// Svix's own test secret. Kaiten does not sign: Svix does, so a consumer verifies
// the Svix format against the secret of its endpoint.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const TIMESTAMP = "1760259600"; // 2025-10-12T09:00:00Z
const AT = Number(TIMESTAMP) * 1000;

/** What the API publishes when an invoice is issued: a NoOp ACTIVATION, waiting for handoff. */
const ISSUED = {
  name: "INSTANCE_INVOICE_ISSUED",
  type: "com.kaiten.instance.invoice.v1.issued",
  data: {
    boundaryAt: "2026-10-01T00:00:00Z",
    collectionMethod: "SEND_INVOICE",
    createdAt: "2026-10-01T00:00:00Z",
    currency: "USD",
    customerName: "Initech",
    customerSlug: "initech",
    daysUntilDue: 30,
    discountTotal: 0,
    dueAt: "2026-10-31T00:00:00Z",
    handoffStatus: "PENDING",
    holdReason: null,
    id: "5f0c1a52-8c1e-4b7e-9d3a-1c2d3e4f5a6b",
    instanceName: "Initech production",
    instanceSlug: "initech-prod",
    issuedAt: "2026-10-01T00:00:00Z",
    kind: "ACTIVATION",
    licenseId: "7a1f0f3e-2b9c-4f61-8a55-0c2f6f7d9e10",
    licenseSlug: "pro-v2",
    lines: [],
    overdue: false,
    paidAt: null,
    providerKind: "NOOP",
    serviceFrom: "2026-10-01T00:00:00Z",
    serviceTo: "2026-11-01T00:00:00Z",
    status: "MANUAL",
    subtotal: 2900,
    total: 2900,
    updatedAt: "2026-10-01T00:00:00Z",
  },
} satisfies OnInstanceInvoiceIssuedWebhookPayload;

/** What the API publishes three days before a trial ends: the instance's billing, still in TRIAL. */
const TRIAL_WILL_END = {
  name: "INSTANCE_BILLING_TRIAL_WILL_END",
  type: "com.kaiten.instance.billing.v1.trial_will_end",
  data: {
    anchorAt: "2026-10-01T00:00:00Z",
    basePrice: {
      billingModel: "FLAT_FEE",
      billingPeriod: "MONTHLY",
      billingTiming: "ADVANCE",
      currency: "USD",
      deprecatedAt: null,
      displayLabel: null,
      displayOrder: 0,
      isDefault: true,
      metered: null,
      status: "ACTIVE",
      unitAmount: 2900,
      unitAmountDecimal: "2900",
    },
    billingPeriod: "MONTHLY",
    cancelAtPeriodEnd: false,
    cancelRequestedAt: null,
    canceledAt: null,
    cancellationReason: null,
    collectionMethod: "CHARGE_AUTOMATICALLY",
    collectionMethodOverride: null,
    createdAt: "2026-10-01T00:00:00Z",
    currency: "USD",
    currentPeriodEnd: "2026-10-15T00:00:00Z",
    currentPeriodStart: "2026-10-01T00:00:00Z",
    customerName: "Initech",
    customerSlug: "initech",
    daysUntilDue: 0,
    daysUntilDueOverride: null,
    id: "3c9e2f41-6a7b-4d8c-9e0f-1a2b3c4d5e6f",
    instanceName: "Initech production",
    instanceSlug: "initech-prod",
    pastDueSince: null,
    providerKind: "STRIPE",
    scheduledChange: null,
    startedAt: "2026-10-01T00:00:00Z",
    status: "TRIAL",
    trialEndsAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  },
} satisfies OnInstanceBillingTrialWillEndWebhookPayload;

/** The delivery of `body` as Svix signs it: `id.timestamp.payload`, HMAC-SHA256. */
async function delivered(body: string) {
  const id = "msg_2NLXk8pQ4sRvT1bYcHdZ";
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(SECRET.slice("whsec_".length)), (char) => char.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${TIMESTAMP}.${body}`)),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return {
    payload: body,
    headers: {
      "svix-id": id,
      "svix-timestamp": TIMESTAMP,
      "svix-signature": `v1,${btoa(binary)}`,
    },
  };
}

const verify = (input: Awaited<ReturnType<typeof delivered>>) =>
  verifyKaitenWebhook({ ...input, secret: SECRET, now: AT });

describe("a relayed billing event", () => {
  test("verifies, and is narrowed to the payload of its type", async () => {
    const event = await verify(await delivered(JSON.stringify(ISSUED)));

    expect(isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.issued")).toBe(true);
    if (!isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.issued")) {
      throw new Error("the event was not narrowed");
    }
    // `total` is the invoice's, in minor units, next to its currency.
    expect(event.data.total).toBe(2900);
    expect(event.data.currency).toBe("USD");
    expect(event.data.handoffStatus).toBe("PENDING");
    expectTypeOf(event).toEqualTypeOf<OnInstanceInvoiceIssuedWebhookPayload>();
    expectTypeOf(event.data.total).toEqualTypeOf<number>();
  });

  test("is not another type, and a handler narrows it by `type` as well", async () => {
    const event = await verify(await delivered(JSON.stringify(ISSUED)));

    expect(isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.paid")).toBe(false);
    expect(isKaitenWebhookOfType(event, "com.kaiten.customer.v1.created")).toBe(false);

    const read = (received: KaitenWebhookEvent) => {
      switch (received.type) {
        case "com.kaiten.instance.invoice.v1.issued":
          return { issued: received.data.total };
        case "com.kaiten.instance.invoice.v1.handoff_acknowledged":
          return { acknowledged: received.data.externalReference };
        case "com.kaiten.voucher.v1.expired":
          return { expired: received.data };
        default:
          return { ignored: received.type };
      }
    };
    expect(read(event)).toEqual({ issued: 2900 });
  });

  test("a body changed after it was signed is refused", async () => {
    const original = await delivered(JSON.stringify(ISSUED));
    const tampered = JSON.stringify({ ...ISSUED, data: { ...ISSUED.data, total: 2901 } });

    await expect(verify({ ...original, payload: tampered })).rejects.toBeInstanceOf(
      KaitenWebhookVerificationError,
    );
    await expect(verify({ ...original, payload: tampered })).rejects.toThrow(/no signature/);
  });

  test("tolerates the members a relay adds beyond the contract's", async () => {
    // The relay that delivers events adds a `headers` member the contract's
    // body does not declare. A strict consumer would refuse it; this one reads
    // what it knows, and the signature covers the bytes as they came.
    const relayed = { ...ISSUED, headers: { "x-relay": "1" } };
    const event = await verify(await delivered(JSON.stringify(relayed)));

    expect(event.type).toBe("com.kaiten.instance.invoice.v1.issued");
    if (isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.issued")) {
      expect(event.data.total).toBe(2900);
    }
  });

  test("tells a subscription its trial is about to end, with the billing it concerns", async () => {
    const event = await verify(await delivered(JSON.stringify(TRIAL_WILL_END)));

    if (!isKaitenWebhookOfType(event, "com.kaiten.instance.billing.v1.trial_will_end")) {
      throw new Error("the event was not narrowed");
    }
    expect(event.name).toBe("INSTANCE_BILLING_TRIAL_WILL_END");
    expect(event.data.status).toBe("TRIAL");
    expect(event.data.trialEndsAt).toBe("2026-10-15T00:00:00Z");
    expect(event.data.instanceSlug).toBe("initech-prod");
    expectTypeOf(event.data.trialEndsAt).toEqualTypeOf<string | null>();
  });

  test("carries the acknowledgement of a handoff as its own type", async () => {
    const acknowledged = {
      name: "INSTANCE_INVOICE_HANDOFF_ACKNOWLEDGED",
      type: "com.kaiten.instance.invoice.v1.handoff_acknowledged",
      data: {
        invoiceId: ISSUED.data.id,
        externalReference: "ERP-1",
        acknowledgedBy: "9b2f4d20-6c1a-4f55-8e07-3d4c5b6a7f80",
      },
    };
    const event = await verify(await delivered(JSON.stringify(acknowledged)));

    expect(
      isKaitenWebhookOfType(event, "com.kaiten.instance.invoice.v1.handoff_acknowledged"),
    ).toBe(true);
    expectTypeOf<
      Extract<KaitenWebhookEvent, { type: "com.kaiten.instance.invoice.v1.handoff_acknowledged" }>
    >().toEqualTypeOf<OnInstanceInvoiceHandoffAcknowledgedWebhookPayload>();
  });
});
