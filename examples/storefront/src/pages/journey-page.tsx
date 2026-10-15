import { useState } from "react";

import { usePlans, usePortal } from "@kaitencloud/react-ui";

import { chapters, coming, type Action, type Scenario, type Step } from "../journey/scenarios.ts";
import { StandInPanel } from "../journey/stand-in-panel.tsx";
import { useStandIn } from "../journey/stand-in.ts";
import { Link } from "../router.tsx";

/**
 * The payment lifecycle, walked in the order a presenter tells it. Each scenario has steps; a step
 * has a button that drives the stand-in for Kaiten, or a link to the real page where the SDK's
 * components take over. Beside them, the stand-in's own state and event log, which move as the
 * presenter goes.
 *
 * It needs the stand-in: against your Kaiten there is nothing to start over or fast-forward, so the
 * buttons are off and the links remain.
 */
export function JourneyPage({ mode }: { mode: "double" | "live" }) {
  const double = mode === "double";
  const { state, events, failure, refresh } = useStandIn(double);
  const { data: plans } = usePlans();
  const portal = usePortal();
  const growth = plans?.find((plan) => plan.slug === "growth-v1");
  const list = chapters({ growthPriceId: growth?.prices?.[0]?.id });

  // The stand-in moved under the SDK's feet: its components read the portal when the page opens and
  // every five minutes, so a change made from here has to be read again, or the account would show
  // the customer as they were. A host that changes a customer outside the SDK does the same.
  const afterAction = async () => {
    await refresh();
    portal.refetch();
  };

  return (
    <section aria-labelledby="journey-title" className="journey">
      <div className="hero">
        <p className="eyebrow">Journey</p>
        <h1 id="journey-title">The payment journey, step by step</h1>
        <p className="lead">
          From a first purchase to a cancellation. Each step has a button that moves the stand-in
          for Kaiten, or a link to the page where a customer would be.
        </p>
        {double ? (
          <p className="jump-link">
            <a href="#stand-in">Jump to what the stand-in holds</a>
          </p>
        ) : null}
      </div>

      {double ? null : (
        <p className="notice" role="note">
          This storefront runs against a Kaiten, not the stand-in. The buttons start customers over
          and fast-forward time, which only the stand-in can do, so they are off. The links still
          work.
        </p>
      )}

      <div className="journey-layout">
        <div className="journey-scenarios">
          {list.map((chapter) => (
            <section key={chapter.title} aria-labelledby={`chapter-${slug(chapter.title)}`}>
              <h2 id={`chapter-${slug(chapter.title)}`} className="chapter-title">
                {chapter.title}
              </h2>
              {chapter.scenarios.map((scenario, index) => (
                <ScenarioCard
                  key={scenario.id}
                  scenario={scenario}
                  number={index + 1}
                  enabled={double}
                  onDone={afterAction}
                />
              ))}
            </section>
          ))}

          <section aria-labelledby="chapter-coming">
            <h2 id="chapter-coming" className="chapter-title">
              Coming with the v3.1 contract
            </h2>
            <p className="muted">
              Kaiten will do these under the v3.1 contract. The stand-in does not play them yet, so
              there is nothing to press: what it does in the meantime is said, not hidden.
            </p>
            <ul className="coming-list">
              {coming.map((item) => (
                <li key={item.id} className="panel coming" data-testid={`coming-${item.id}`}>
                  <h3>
                    {item.title} <span className="pill">{item.ref}</span>
                  </h3>
                  <p>{item.will}</p>
                  <p className="muted">
                    <strong>Today:</strong> {item.today}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {double ? (
          <aside id="stand-in" className="journey-aside" aria-label="The stand-in right now">
            <StandInPanel state={state} events={events} failure={failure} />
            <p className="jump-link">
              <a href="#journey-title">Back to the scenarios</a>
            </p>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function ScenarioCard({
  scenario,
  number,
  enabled,
  onDone,
}: {
  scenario: Scenario;
  number: number;
  enabled: boolean;
  onDone: () => void | Promise<void>;
}) {
  return (
    <article className="panel scenario" aria-labelledby={`scenario-${scenario.id}`}>
      <h3 id={`scenario-${scenario.id}`}>
        <span className="scenario-number" aria-hidden="true">
          {number}
        </span>
        {scenario.title}
      </h3>
      <p className="muted">{scenario.lead}</p>
      <ol className="steps">
        {scenario.steps.map((step) => (
          <StepRow key={step.text} step={step} enabled={enabled} onDone={onDone} />
        ))}
      </ol>
    </article>
  );
}

function StepRow({
  step,
  enabled,
  onDone,
}: {
  step: Step;
  enabled: boolean;
  onDone: () => void | Promise<void>;
}) {
  // One outcome per step, whichever of its buttons was pressed last.
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (action: Extract<Action, { kind: "do" }>) => {
    setOutcome(null);
    try {
      const text = (await action.run()) ?? "Done.";
      setOutcome({ ok: true, text });
    } catch (error) {
      setOutcome({ ok: false, text: error instanceof Error ? error.message : String(error) });
    }
    await onDone();
  };

  return (
    <li className="step">
      <p>{step.text}</p>
      <div className="step-actions">
        {step.actions.map((action) =>
          action.kind === "go" ? (
            <Link key={action.label} to={action.to} className="btn btn-secondary">
              {action.label}
            </Link>
          ) : (
            <RunButton
              key={action.label}
              label={action.label}
              disabled={!enabled}
              onRun={() => run(action)}
            />
          ),
        )}
      </div>
      {outcome ? (
        <p className={outcome.ok ? "step-outcome" : "step-outcome error"} role="status">
          {outcome.text}
        </p>
      ) : null}
    </li>
  );
}

function RunButton({
  label,
  disabled,
  onRun,
}: {
  label: string;
  disabled: boolean;
  onRun: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
