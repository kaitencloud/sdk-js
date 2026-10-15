import type { StandInEvent, StandInState } from "./stand-in.ts";

const date = (iso: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

const money = (minorUnits: number, currency: string) => {
  const format = new Intl.NumberFormat("en", { style: "currency", currency });
  return format.format(minorUnits / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
};

const PAYMENTS: Record<StandInState["payment"], string> = {
  paid: "will succeed",
  failed: "will be declined",
  requires_action: "will ask the customer to confirm (3-D Secure)",
  processing: "will stay undecided for now",
};

const INVOICE_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "error" }> = {
  PAID: { label: "Paid", tone: "ok" },
  PUSHED: { label: "Processing", tone: "warn" },
  PAYMENT_FAILED: { label: "Payment failed", tone: "error" },
};

const SUBSCRIPTION_STATUS = {
  TRIAL: { label: "Trial", tone: "warn" },
  ACTIVE: { label: "Active", tone: "ok" },
  PAST_DUE: { label: "Past due", tone: "error" },
} as const;

/** An add-on's slug as a person says it: `extra-seats-v1` is Extra seats. */
const addonName = (slug: string) =>
  slug
    .replace(/-v\d+$/, "")
    .replace(/-/g, " ")
    .replace(/^./, (first) => first.toUpperCase());

/**
 * What the stand-in for Kaiten holds of its customer, and what it would have told the vendor. It is
 * read from the stand-in itself, not from the page's own components, so that it can disagree with
 * them: that is the point of showing it.
 */
export function StandInPanel({
  state,
  events,
  failure,
}: {
  state: StandInState | null;
  events: StandInEvent[];
  failure: string | null;
}) {
  if (!state) {
    return (
      <div className="panel">
        <h2 className="panel-title">The stand-in right now</h2>
        <p
          className={failure ? "step-outcome error" : "muted"}
          role={failure ? "alert" : undefined}
        >
          {failure ?? "Reading the stand-in…"}
        </p>
      </div>
    );
  }

  const status = state.status ? SUBSCRIPTION_STATUS[state.status] : null;
  return (
    <div className="panel" data-testid="stand-in-state">
      <h2 className="panel-title">The stand-in right now</h2>
      <dl className="facts">
        <dt>Plan</dt>
        <dd data-testid="state-plan">
          {state.planName ?? "None"}
          {status ? (
            <span className={`badge badge-${status.tone}`}>{status.label}</span>
          ) : (
            <span className="badge">No subscription</span>
          )}
          {state.free ? <span className="badge">Free</span> : null}
          {state.cancelAtPeriodEnd ? (
            <span className="badge badge-warn">Ends at period end</span>
          ) : null}
        </dd>

        {state.trialEndsAt ? (
          <>
            <dt>Trial ends</dt>
            <dd>{date(state.trialEndsAt)}</dd>
          </>
        ) : null}
        {state.currentPeriodEnd ? (
          <>
            <dt>Next boundary</dt>
            <dd>{date(state.currentPeriodEnd)}</dd>
          </>
        ) : null}
        {state.scheduledChange ? (
          <>
            <dt>Scheduled</dt>
            <dd data-testid="state-scheduled">
              {addonName(state.scheduledChange.plan)} on {date(state.scheduledChange.effectiveAt)}
            </dd>
          </>
        ) : null}
        <dt>Card</dt>
        <dd>{state.card ?? "None"}</dd>
        {state.addOns.length > 0 ? (
          <>
            <dt>Add-ons</dt>
            <dd>
              {state.addOns.map((each) => `${addonName(each.slug)} × ${each.quantity}`).join(", ")}
            </dd>
          </>
        ) : null}
        <dt>Next payment</dt>
        <dd>{PAYMENTS[state.payment]}</dd>
      </dl>

      <h3 className="panel-subtitle">Invoices</h3>
      {state.invoices.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="invoice-list">
          {state.invoices.map((invoice) => {
            const known = INVOICE_STATUS[invoice.status] ?? { label: invoice.status, tone: "warn" };
            return (
              <li key={invoice.id}>
                <span>
                  {invoice.providerInvoiceNumber}{" "}
                  <span className="muted">{invoice.kind.toLowerCase()}</span>
                </span>
                <span>{money(invoice.total, invoice.currency)}</span>
                <span className={`badge badge-${known.tone}`}>{known.label}</span>
              </li>
            );
          })}
        </ul>
      )}

      <h3 className="panel-subtitle">What Kaiten would tell the vendor</h3>
      {events.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ol className="event-log" data-testid="event-log">
          {[...events].reverse().map((event, index) => (
            <li key={`${event.at}-${events.length - index}`}>
              <code>{event.type}</code>
              <span className="muted">{event.detail}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">
        A log kept by the stand-in. It sends no webhook: that comes with the v3.1 contract.
      </p>
    </div>
  );
}
