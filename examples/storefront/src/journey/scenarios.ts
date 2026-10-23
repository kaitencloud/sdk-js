// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What the journey page walks a presenter through: scenarios of the payment lifecycle, each a few
// steps. A step says what to look at, and has the control that gets there: a button that drives the
// stand-in for Kaiten (start a customer, say what the next payment comes to, move to the next
// boundary), or a link to the real page of the storefront where the SDK's components do the rest.
//
// Only what the stand-in really plays is a scenario. What Kaiten will do under the v3.1 contract and
// the stand-in does not yet is listed as such, in `coming`, with nothing to press.

import { standIn } from "./stand-in.ts";

export type Action =
  | {
      kind: "do";
      label: string;
      /** Drives the stand-in. What it resolves with is shown, and a refusal too. */
      run: () => Promise<string | void>;
    }
  | { kind: "go"; label: string; to: string };

export interface Step {
  /** What the presenter says, or what to look at on the page. */
  text: string;
  actions: Action[];
}

export interface Scenario {
  id: string;
  title: string;
  /** What the scenario shows, in a sentence. */
  lead: string;
  steps: Step[];
}

export interface Chapter {
  title: string;
  scenarios: Scenario[];
}

/** What the scenarios need to know of the catalogue. */
export interface JourneyCatalogue {
  /** The id of Growth's price, which the vendor's plan change names. */
  growthPriceId: string | undefined;
}

const start = (
  label: string,
  point: Parameters<typeof standIn.start>[0],
  payment?: Parameters<typeof standIn.start>[1],
): Action => ({
  kind: "do",
  label,
  run: async () => {
    await standIn.start(point, payment);
    return "The customer is back to this starting point.";
  },
});

const go = (label: string, to: string): Action => ({ kind: "go", label, to });
const advance: Action = {
  kind: "do",
  label: "Advance to the boundary",
  run: () => standIn.advance(),
};

export function chapters(catalogue: JourneyCatalogue): Chapter[] {
  return [
    {
      title: "Buying a plan",
      scenarios: [
        {
          id: "visitor",
          title: "A visitor signs up and buys a plan",
          lead: "When the publishable key does not open the anonymous checkout, a checkout is a customer's: the storefront's backend makes the customer and its instance when the visitor signs up, then mints their session.",
          steps: [
            {
              text: "Start as a visitor: no account, no customer, no instance in Kaiten yet. The pricing table is public.",
              actions: [start("Start as a visitor", { signUp: true }), go("Open the plans", "/")],
            },
            {
              text: "Choose a plan. The checkout asks to create an account first: a name, and the e-mail the invoices go to. The backend creates the customer and an instance on the free plan, and the checkout carries on.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
            {
              text: "The account page names the customer. Sign out forgets the account, and the next visitor starts again.",
              actions: [go("Open the account", "/portal")],
            },
          ],
        },
        {
          id: "anonymous",
          title: "A visitor buys with no account",
          lead: "The publishable key opens the anonymous checkout: the visitor gives an e-mail and passes a security check, and Kaiten makes the customer, its instance and the subscription when the checkout completes. The storefront's backend is not asked for anything.",
          steps: [
            {
              text: "Start as a visitor, with the key's anonymous checkout on. The catalogue now says so, with the site key of the security check.",
              actions: [
                start("Start as a visitor", { signUp: true, anonymousCheckout: true }),
                go("Open the plans", "/"),
              ],
            },
            {
              text: "Choose Starter, give an e-mail and pass the security check: the plan is free, so the checkout completes at once. Kaiten tells the vendor with a checkout_session.v1.completed event, in the log beside.",
              actions: [go("Open Starter's checkout", "/checkout/starter-v1")],
            },
            {
              text: "Choose Pro instead: the review shows what is due, the provider's page saves a card, and the plan starts once the first invoice is paid. Until then the new instance is on the free plan.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
            {
              text: "Make the security check fail for the next verification, then try again with the same choices.",
              actions: [
                {
                  kind: "do",
                  label: "Refuse the next security check",
                  run: async () => {
                    await standIn.turnstile("fail", 1);
                    return "The next verification is refused. The one after passes.";
                  },
                },
              ],
            },
            {
              text: "Let the time pass that closes a checkout nobody confirmed. The visitor who comes back is told it stayed open for too long, and can start again.",
              actions: [
                {
                  kind: "do",
                  label: "Let a checkout expire",
                  run: () => standIn.expireCheckout(),
                },
              ],
            },
          ],
        },
        {
          id: "trial",
          title: "Buy a plan with a trial",
          lead: "Growth starts with 14 days free. Nothing is due today, and the card is asked for anyway.",
          steps: [
            {
              text: "Start from a new customer, with no card and no billing email.",
              actions: [start("Start over", {})],
            },
            {
              text: "Choose Growth, give an email and save the card on the provider's page. The checkout says nothing is due today.",
              actions: [go("Open Growth's checkout", "/checkout/growth-v1")],
            },
            {
              text: "Fast-forward to the end of the trial. The subscription becomes active and the first period is billed to the card.",
              actions: [
                {
                  kind: "do",
                  label: "End the trial now",
                  run: () => standIn.endTrial(),
                },
              ],
            },
            {
              text: "The account shows the active subscription and its activation invoice.",
              actions: [go("Open the account", "/portal")],
            },
          ],
        },
        {
          id: "voucher",
          title: "A voucher: WELCOME20",
          lead: "The server prices the voucher, line by line. The page never does the sums.",
          steps: [
            {
              text: "Start from a customer who has a card and a billing email.",
              actions: [start("Start over", { card: true, email: true })],
            },
            {
              text: "Open Pro's checkout and type WELCOME20 in the voucher field: 20% off the base fee, so €39.20 is due today instead of €49.00.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
          ],
        },
        {
          id: "addon",
          title: "Add-on increase",
          lead: "More seats are in force at once and billed at the next renewal.",
          steps: [
            {
              text: "Start from a customer subscribed to Pro.",
              actions: [start("Start over", { subscribed: true })],
            },
            {
              text: "Press Manage add-ons, then + on Extra seats: before anything is sent, the panel says +1 × €10.00/month, billed from the next renewal. Confirm, and the quantity changes now.",
              actions: [go("Open the account", "/portal")],
            },
            {
              text: "Fast-forward to the renewal. Its invoice has the base fee and one line for the seats.",
              actions: [advance, go("See the invoices", "/portal")],
            },
          ],
        },
      ],
    },
    {
      title: "When a payment does not go through",
      scenarios: [
        {
          id: "declined",
          title: "Card declined, then retried",
          lead: "The subscription starts, the invoice stays open, and the customer pays it again.",
          steps: [
            {
              text: "Start from a customer who has a card, and make the next payment fail.",
              actions: [start("Start over, card declined", { card: true, email: true }, "failed")],
            },
            {
              text: "Subscribe to Pro. The checkout says the card was declined and offers to pay the invoice.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
            {
              text: "The customer pays it on the provider's page, which Pay invoice opens. This button does the same from here.",
              actions: [
                {
                  kind: "do",
                  label: "Settle the open invoice: paid",
                  run: () => standIn.settle("pay"),
                },
              ],
            },
          ],
        },
        {
          id: "three-d-secure",
          title: "3-D Secure",
          lead: "The bank asks the customer to confirm. The checkout waits for them.",
          steps: [
            {
              text: "Start from a customer who has a card, and make the next payment ask for a confirmation.",
              actions: [
                start(
                  "Start over, confirmation needed",
                  { card: true, email: true },
                  "requires_action",
                ),
              ],
            },
            {
              text: "Subscribe to Pro. The checkout asks to confirm the payment and keeps checking; Complete payment opens the provider's page, where the challenge is answered.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
            {
              text: "Or answer the challenge from here.",
              actions: [
                {
                  kind: "do",
                  label: "Confirm the payment",
                  run: () => standIn.settle("pay"),
                },
              ],
            },
          ],
        },
        {
          id: "unknown",
          title: "An outcome that is not known yet",
          lead: "The provider has not said whether the payment went through. Nothing is assumed.",
          steps: [
            {
              text: "Start from a customer who has a card, and leave the next payment undecided.",
              actions: [
                start("Start over, outcome unknown", { card: true, email: true }, "processing"),
              ],
            },
            {
              text: "Subscribe to Pro. The checkout says the payment is being processed and checks again by itself.",
              actions: [go("Open Pro's checkout", "/checkout/pro-v2")],
            },
            {
              text: "The provider finally answers.",
              actions: [
                {
                  kind: "do",
                  label: "Answer: paid",
                  run: () => standIn.settle("pay"),
                },
                {
                  kind: "do",
                  label: "Answer: declined",
                  run: () => standIn.settle("decline"),
                },
              ],
            },
          ],
        },
        {
          id: "past-due",
          title: "A renewal fails: past due, then paid from the portal",
          lead: "The customer finds the unpaid invoice in their account and pays it there.",
          steps: [
            {
              text: "Start from a Pro customer whose next payment will be declined.",
              actions: [start("Start over, card declined", { subscribed: true }, "failed")],
            },
            {
              text: "Fast-forward to the renewal. The invoice is issued, the card is declined, and the subscription is past due.",
              actions: [advance],
            },
            {
              text: "The account lists the unpaid invoice with a Pay button, which opens the provider's page. Pay it there.",
              actions: [go("Open the account", "/portal")],
            },
            {
              text: "Or pay it from here. The subscription is active again.",
              actions: [
                {
                  kind: "do",
                  label: "Settle the open invoice: paid",
                  run: () => standIn.settle("pay"),
                },
              ],
            },
          ],
        },
      ],
    },
    {
      title: "Living with a plan",
      scenarios: [
        {
          id: "payment-method",
          title: "Change the payment method",
          lead: "The customer replaces their card from the portal, on the provider's page.",
          steps: [
            {
              text: "Start from a Pro customer. Their card is a Visa ending 4242.",
              actions: [start("Start over", { subscribed: true })],
            },
            {
              text: "Press Update payment method. The provider's page offers the other card; when you are back, the portal shows it.",
              actions: [go("Open the account", "/portal")],
            },
          ],
        },
        {
          id: "cancel",
          title: "Cancel, then withdraw",
          lead: "A cancellation takes effect at the end of the period, and can be withdrawn until then.",
          steps: [
            {
              text: "Start from a Pro customer.",
              actions: [start("Start over", { subscribed: true })],
            },
            {
              text: "Press Cancel subscription, then Cancel at period end. The account says when it ends; Reactivate subscription withdraws the cancellation.",
              actions: [go("Open the account", "/portal")],
            },
            {
              text: "Or let it run: fast-forward to the end of the period. The subscription ends, and the instance keeps its plan.",
              actions: [advance],
            },
          ],
        },
      ],
    },
    {
      title: "Changing plan",
      scenarios: [
        {
          id: "upgrade-from-free",
          title: "Upgrade from the free plan",
          lead: "A checkout replaces a subscription that has no paid price: cancelled at once, with no invoice, and the new one starts in the same step.",
          steps: [
            {
              text: "Start from a customer on Starter, which is free.",
              actions: [start("Start on Starter", { free: true })],
            },
            {
              text: "Choose Pro in the pricing table and subscribe. In the event log, the free subscription is cancelled with no final invoice, then Pro starts.",
              actions: [go("Open the plans", "/")],
            },
            {
              text: "Any other live subscription still answers 409: try Growth now.",
              actions: [go("Open Growth's checkout", "/checkout/growth-v1")],
            },
          ],
        },
        {
          id: "change-plan",
          title: "Change plan: a commercial request",
          lead: "In V1 a customer does not switch paid plans by themselves. The button opens the plan's own link.",
          steps: [
            {
              text: "Start from a Pro customer.",
              actions: [start("Start over", { subscribed: true })],
            },
            {
              text: "Press Change plan. It opens the selfServeCtaUrl of the plan the customer is on, here the storefront's sales page, with the plan in its address.",
              actions: [go("Open the account", "/portal")],
            },
          ],
        },
        {
          id: "scheduled",
          title: "The vendor schedules a plan change",
          lead: "The vendor moves the customer to another plan at the next boundary, with the server token.",
          steps: [
            {
              text: "Start from a Pro customer.",
              actions: [start("Start over", { subscribed: true })],
            },
            {
              text: "The vendor's back office schedules Growth. The storefront's backend calls Billing.schedulePlanChange of @kaitencloud/server; the customer's session cannot.",
              actions: [
                {
                  kind: "do",
                  label: "Schedule Growth",
                  run: async () => {
                    if (!catalogue.growthPriceId) throw new Error("The plans are not loaded yet.");
                    return standIn.schedulePlanChange(catalogue.growthPriceId);
                  },
                },
              ],
            },
            {
              text: "The account shows the change that waits. The vendor can still drop it.",
              actions: [
                go("Open the account", "/portal"),
                {
                  kind: "do",
                  label: "Drop the change",
                  run: () => standIn.dropPlanChange(),
                },
              ],
            },
            {
              text: "Fast-forward to the boundary. The invoice is Growth's, and so is the plan.",
              actions: [advance],
            },
          ],
        },
      ],
    },
  ];
}

/** What the v3.1 contract adds and the stand-in does not play yet. Nothing here is pretended. */
export interface Coming {
  id: string;
  title: string;
  /** What Kaiten will do. */
  will: string;
  /** What the stand-in does in the meantime. */
  today: string;
}

export const coming: Coming[] = [
  {
    id: "incomplete",
    title: "Pay before getting the plan",
    will: "A checkout with an amount due keeps the previous plan until the invoice is paid, for up to 23 hours. The subscription is INCOMPLETE meanwhile, and expires if nobody pays.",
    today:
      "A customer's checkout in the stand-in subscribes at once, and a payment that fails leaves an open invoice on an active plan. A visitor's anonymous checkout plays it: the instance waits on the free plan for the first invoice.",
  },
  {
    id: "trial-end",
    title: "A trial that ends without a card",
    will: "The vendor chooses, per plan family, between CANCEL (the subscription ends) and CONVERT (the first invoice is issued and fails, so the subscription is past due).",
    today:
      "The stand-in converts a trial that has a card, and refuses to end one that has none, saying so.",
  },
  {
    id: "fallback",
    title: "Fallback to the free plan",
    will: "When a subscription ends, the instance moves to the free plan its family names.",
    today: "The instance keeps the plan it had, with no subscription.",
  },
  {
    id: "addon-decrease",
    title: "Add-on decrease at the next boundary",
    will: "Removing seats is scheduled for the next boundary and access is kept until then. The portal shows the pending quantity.",
    today: "A decrease is in force at once, as the current contract says.",
  },
  {
    id: "true-up",
    title: "True-up of add-ons",
    will: "At the boundary an add-on billed in advance is also billed for the highest quantity held during the period that ended.",
    today: "The renewal bills the quantity held at the boundary.",
  },
  {
    id: "trial-will-end",
    title: "The trial_will_end webhook",
    will: "Kaiten tells the vendor's backend three days before a trial ends, so that it can ask for a card.",
    today:
      "The stand-in logs the events it would send but delivers no webhook, and the storefront has no receiver yet.",
  },
  {
    id: "one-trial",
    title: "One trial per customer and plan family",
    will: "A customer who had a trial of a family does not get a second one.",
    today:
      "Every checkout of Growth by a customer gets its trial. A visitor's anonymous checkout plays the rule: one trial per e-mail address and family.",
  },
];
