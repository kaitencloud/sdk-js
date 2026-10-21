// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useId, useRef, useState, type FormEvent } from "react";

import { useAccount } from "../account.tsx";
import { signUp, type SignUpRefusal } from "../config.ts";
import { Link } from "../router.tsx";
import { checkSignUp, FIELD_MESSAGES, type SignUpFields } from "../sign-up-fields.ts";

/**
 * What a visitor does before they can buy, when the storefront has no customer for them yet: say who they
 * are. Kaiten V1 has no anonymous checkout, so a checkout needs a customer, and the storefront's backend
 * makes one from this: a name and the e-mail the invoices go to.
 *
 * `plan` is the plan the visitor came to buy, if they did: the backend needs it when the catalogue has no
 * free plan to start the new account on.
 */
export function SignUpStep({ plan }: { plan?: { slug: string; name?: string } }) {
  const account = useAccount();
  const ids = { name: useId(), email: useId(), summary: useId() };
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState({ name: "", email: "" });
  const [fields, setFields] = useState<SignUpFields>({});
  const [refusal, setRefusal] = useState<SignUpRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  /** Shows what is wrong, and puts the keyboard on the first field that is. */
  const show = (next: SignUpFields, other: SignUpRefusal | null = null) => {
    setFields(next);
    setRefusal(other);
    (next.name ? nameField : emailField).current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const checked = checkSignUp(values);
    if (!checked.ok) return show(checked.fields);

    setFields({});
    setRefusal(null);
    setBusy(true);
    const outcome = await signUp({ name: checked.name, email: checked.email, plan: plan?.slug });
    if (outcome.ok) {
      // This form goes away with the account: nothing is left to un-busy.
      account.signedUp();
      return;
    }
    setBusy(false);
    const { refusal: refused } = outcome;
    if (refused.kind === "invalid") show(refused.fields);
    else if (refused.kind === "invalid_email") show({ email: "invalid" });
    else setRefusal(refused);
  };

  const count = Number(Boolean(fields.name)) + Number(Boolean(fields.email));
  const summary =
    count > 0 ? `Check ${count === 1 ? "the field" : "the fields"} marked below.` : null;
  const named = plan?.name ? ` to subscribe to ${plan.name}` : "";

  return (
    <section aria-labelledby="signup-title" className="page-narrow">
      <h1 id="signup-title" className="page-heading">
        Create your account{named}
      </h1>
      <p className="lead signup-lead">
        {plan
          ? "Your plan is held while we set you up: you carry on with it right after."
          : "Plans are bought from an account. It takes a name and an e-mail."}
      </p>

      <form className="panel signup" onSubmit={submit} noValidate>
        <div id={ids.summary} role="alert" className="signup-alert">
          {summary ? <p className="notice error">{summary}</p> : null}
          {refusal ? <Refusal refusal={refusal} /> : null}
        </div>

        <div className="field">
          <label htmlFor={ids.name}>Name</label>
          <p id={`${ids.name}-hint`} className="field-hint">
            Your company&rsquo;s name, or your own.
          </p>
          <input
            ref={nameField}
            id={ids.name}
            name="name"
            type="text"
            autoComplete="organization"
            value={values.name}
            onChange={(event) => setValues({ ...values, name: event.target.value })}
            aria-invalid={fields.name ? true : undefined}
            aria-describedby={
              fields.name ? `${ids.name}-hint ${ids.name}-error` : `${ids.name}-hint`
            }
          />
          {fields.name ? (
            <p id={`${ids.name}-error`} className="field-error">
              {FIELD_MESSAGES.name[fields.name]}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor={ids.email}>E-mail</label>
          <p id={`${ids.email}-hint`} className="field-hint">
            Invoices are sent here.
          </p>
          <input
            ref={emailField}
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => setValues({ ...values, email: event.target.value })}
            aria-invalid={fields.email ? true : undefined}
            aria-describedby={
              fields.email ? `${ids.email}-hint ${ids.email}-error` : `${ids.email}-hint`
            }
          />
          {fields.email ? (
            <p id={`${ids.email}-error`} className="field-error">
              {FIELD_MESSAGES.email[fields.email]}
            </p>
          ) : null}
        </div>

        <div className="signup-actions">
          <button type="submit" className="btn" disabled={busy} aria-busy={busy || undefined}>
            {busy ? "Creating your account…" : "Create account"}
          </button>
          {plan ? (
            <Link to="/" className="btn btn-secondary">
              Back to the plans
            </Link>
          ) : null}
        </div>
      </form>
    </section>
  );
}

/** What the backend said that is not about a field. The first line is for the visitor, the second for a developer. */
function Refusal({ refusal }: { refusal: SignUpRefusal }) {
  switch (refusal.kind) {
    case "plan_required":
      return (
        <p className="notice error">
          Choose a plan first. <Link to="/">See the plans</Link>
        </p>
      );
    case "rate_limited":
      return (
        <p className="notice error">
          Too many accounts were made just now. Try again in {refusal.retryAfter}{" "}
          {refusal.retryAfter === 1 ? "second" : "seconds"}.
        </p>
      );
    case "unavailable":
      return (
        <p className="notice error">
          Accounts can&rsquo;t be created right now. Try again in {refusal.retryAfter}{" "}
          {refusal.retryAfter === 1 ? "second" : "seconds"}.
        </p>
      );
    case "missing_scope":
      return (
        <div className="notice error">
          <p>Accounts can&rsquo;t be created right now.</p>
          <p className="signup-developer">
            For the developer: the server token does not hold <code>{refusal.scope}</code>. Sign-up
            mode needs <code>write:customers</code>, <code>write:instances</code> and{" "}
            <code>write:customer_sessions</code>.
          </p>
        </div>
      );
    case "limit_reached":
      return (
        <div className="notice error">
          <p>Accounts can&rsquo;t be created right now.</p>
          <p className="signup-developer">
            For the developer: your Kaiten organization reached its limit of customers or instances.
          </p>
        </div>
      );
    default:
      return (
        <p className="notice error">
          Accounts can&rsquo;t be created right now. Try again in a moment.
        </p>
      );
  }
}
