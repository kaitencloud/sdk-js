// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { useAccount } from "../account.tsx";
import { signUp, type SignUpRefusal } from "../config.ts";
import { Link } from "../router.tsx";
import { checkSignUp, FIELD_MESSAGES, type SignUpFields } from "../sign-up-fields.ts";

/**
 * What a visitor does before they can buy, when the storefront has no customer for them yet and the
 * publishable key does not open the anonymous checkout: say who they are. A customer's checkout needs a
 * customer, and the storefront's backend makes one from this: a name and the email the invoices go to.
 * It is also what the Account page offers a visitor, whatever the key opens.
 *
 * `plan` is the plan the visitor came to buy, if they did: it is named in the title, and the page goes on
 * to its checkout once the account exists. It is not sent to the backend, which decides by itself what
 * licence a new account starts on: a visitor does not get to choose that.
 */
export function SignUpStep({ plan }: { plan?: { slug: string; name?: string } }) {
  const account = useAccount();
  const ids = { name: useId(), email: useId(), summary: useId() };
  const nameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const alertBox = useRef<HTMLDivElement>(null);

  const [values, setValues] = useState({ name: "", email: "" });
  const [fields, setFields] = useState<SignUpFields>({});
  const [refusal, setRefusal] = useState<SignUpRefusal | null>(null);
  const [busy, setBusy] = useState(false);

  // A refusal that is not about a field has nowhere to put the keyboard but its message: the submit button
  // is disabled while the account is asked for, which drops the focus it held, and a keyboard or
  // screen-reader user would otherwise have to tab in from the top of the page to try again.
  useEffect(() => {
    if (refusal) alertBox.current?.focus();
  }, [refusal]);

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
    const outcome = await signUp({ name: checked.name, email: checked.email });
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
          ? "You carry on with this plan right after."
          : "Plans are bought from an account. It takes a name and an email."}
      </p>

      <form className="panel signup" onSubmit={submit} noValidate>
        <div id={ids.summary} ref={alertBox} tabIndex={-1} role="alert" className="signup-alert">
          {summary ? <p className="notice error">{summary}</p> : null}
          {refusal ? <Refusal refusal={refusal} /> : null}
        </div>

        <div className="field">
          <label htmlFor={ids.name}>
            Name <span className="field-required">(required)</span>
          </label>
          <p id={`${ids.name}-hint`} className="field-hint">
            Your company&rsquo;s name, or your own.
          </p>
          <input
            ref={nameField}
            id={ids.name}
            name="name"
            type="text"
            autoComplete="organization"
            aria-required="true"
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
          <label htmlFor={ids.email}>
            Email <span className="field-required">(required)</span>
          </label>
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
            aria-required="true"
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
            mode needs the scopes write:customers, write:instances and write:customer_sessions on
            it.
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
    case "free_plan_required":
      return (
        <div className="notice error">
          <p>Accounts can&rsquo;t be created right now.</p>
          <p className="signup-developer">
            For the developer: the catalogue has no free plan to start a new account on. Publish
            one.
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
