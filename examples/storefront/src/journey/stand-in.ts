// The journey page's hands on the stand-in for Kaiten: its control surface, under
// `/kaiten-double/control`, and the storefront backend's vendor route. A test drives the same
// surface from Playwright (`e2e/support/stand-in.ts`); the page does it from the browser, on the
// storefront's own origin, which is the only origin the stand-in obeys.

import { useCallback, useEffect, useState } from "react";

const CONTROL = "/kaiten-double/control";
const VENDOR_PLAN_CHANGE = "/storefront-api/vendor/plan-change";

export type PaymentOutcome = "paid" | "requires_action" | "failed" | "processing";

/** What the stand-in says of its customer. */
export interface StandInState {
  subscribed: boolean;
  cancelAtPeriodEnd: boolean;
  cardOnFile: boolean;
  billingEmail: string | null;
  invoices: Array<{
    id: string;
    kind: string;
    status: string;
    total: number;
    currency: string;
    providerInvoiceNumber: string;
  }>;
  payment: PaymentOutcome;
  plan: string | null;
  planName: string | null;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | null;
  free: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  scheduledChange: { plan: string; priceId: string; effectiveAt: string } | null;
  addOns: Array<{ slug: string; quantity: number }>;
  card: string | null;
}

/** What Kaiten would have told the vendor. The stand-in delivers none of it. */
export interface StandInEvent {
  type: string;
  at: string;
  detail: string;
}

/** How a customer starts: see `Scenario` in the stand-in. */
export interface StartingPoint {
  card?: boolean;
  email?: boolean;
  subscribed?: boolean;
  free?: boolean;
}

/** A refusal, with the words the stand-in or Kaiten gave for it. */
export class StandInError extends Error {}

async function send(
  path: string,
  init: { method: "GET" | "POST" | "PUT" | "DELETE"; body?: string },
): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const refusal = body as { detail?: string; code?: string; error?: string };
    throw new StandInError(
      refusal.detail ??
        refusal.code ??
        refusal.error ??
        `The stand-in answered ${response.status}.`,
    );
  }
  return body;
}

const post = (path: string, data: unknown = {}) =>
  send(`${CONTROL}${path}`, { method: "POST", body: JSON.stringify(data) });

/** The commands of the journey. Each one resolves with a sentence for the presenter. */
export const standIn = {
  state: () => send(`${CONTROL}/state`, { method: "GET" }) as Promise<StandInState>,
  events: () => send(`${CONTROL}/events`, { method: "GET" }) as Promise<StandInEvent[]>,

  /** Starts again from a customer. `payment` says what becomes of the next payment. */
  async start(point: StartingPoint, payment: PaymentOutcome = "paid") {
    await post("/reset", point);
    await post("/payment", { outcome: payment });
  },

  async payment(outcome: PaymentOutcome) {
    await post("/payment", { outcome });
  },

  /** Moves to the next boundary: a trial converts, a period renews, a plan change applies. */
  async advance(): Promise<string> {
    const result = (await post("/advance")) as { applied: string; invoiceId: string | null };
    return describeBoundary(result.applied, result.invoiceId !== null);
  },

  async endTrial(): Promise<string> {
    const result = (await post("/trial/end")) as { applied: string; invoiceId: string | null };
    return describeBoundary(result.applied, result.invoiceId !== null);
  },

  /** The customer, or the provider, settles the invoice that is open: the newest one. */
  async settle(how: "pay" | "decline"): Promise<string> {
    const { invoices } = await standIn.state();
    const open = invoices.find((invoice) => invoice.status !== "PAID");
    if (!open) throw new StandInError("There is no open invoice to settle.");
    await post(`/invoices/${open.id}/${how}`);
    return `${open.providerInvoiceNumber} is ${how === "pay" ? "paid" : "declined"}.`;
  },

  /** The vendor's back office, through the storefront's backend and its server token. */
  async schedulePlanChange(licensePriceId: string): Promise<string> {
    await send(VENDOR_PLAN_CHANGE, { method: "PUT", body: JSON.stringify({ licensePriceId }) });
    return "The change is scheduled for the next boundary.";
  },

  async dropPlanChange(): Promise<string> {
    await send(VENDOR_PLAN_CHANGE, { method: "DELETE" });
    return "The scheduled change is dropped.";
  },
};

function describeBoundary(applied: string, invoiced: boolean): string {
  const what =
    applied === "trial_converted"
      ? "The trial ended."
      : applied === "plan_changed"
        ? "The period renewed on the new plan."
        : applied === "canceled"
          ? "The cancellation took effect."
          : "The period renewed.";
  return invoiced ? `${what} An invoice was issued.` : `${what} Nothing was billed.`;
}

/**
 * The stand-in's state and event log, read now and again while the page is on screen: a payment
 * made on the provider's page, in another window, shows up here by itself.
 */
export function useStandIn(enabled: boolean) {
  const [state, setState] = useState<StandInState | null>(null);
  const [events, setEvents] = useState<StandInEvent[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextState, nextEvents] = await Promise.all([standIn.state(), standIn.events()]);
      setState(nextState);
      setEvents(nextEvents);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 2000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [enabled, refresh]);

  return { state, events, failure, refresh };
}
