// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { LicenseUsage } from "@kaitencloud/react-ui";

import { useAccount, useTitleFocusAfterSignUp } from "../account.tsx";
import { useDocumentTitle } from "../title.ts";
import { SignUpStep } from "./sign-up-step.tsx";

/**
 * The licence the customer holds and what it has used: the page a vendor gives a customer who wants
 * to follow their consumption, and the page the Kaiten console gives an organization for its own
 * licence. `LicenseUsage` reads the same customer session as the account page and draws one row for
 * every numeric quota of the plan, a capped one with its bar and one nothing caps with what is used
 * out of "Unlimited".
 */
export function LicensePage() {
  const account = useAccount();
  useTitleFocusAfterSignUp(true);
  useDocumentTitle("License usage");

  // The licence is a customer's: a visitor makes an account first.
  if (!account.signedIn) return <SignUpStep />;

  return (
    <section aria-labelledby="license-title" className="page-narrow">
      <div className="hero">
        <p className="eyebrow">License</p>
        <h1 id="license-title">License usage</h1>
        <p className="lead">
          What your plan includes and how much of it you have used. A quota with no cap shows what
          is used out of &ldquo;Unlimited&rdquo;; a capped one shows how far along it is.
        </p>
      </div>
      <LicenseUsage />
    </section>
  );
}
