// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react";

import { CheckoutFlow, usePlans } from "@kaitencloud/react-ui";

import { useAccount, useTitleFocusAfterSignUp } from "../account.tsx";
import { Link, navigate, useLocation } from "../router.tsx";
import { SignUpStep } from "./sign-up-step.tsx";

export function CheckoutPage({ slug }: { slug: string }) {
  const { data: plans, isLoading, error, refetch } = usePlans();
  const { search } = useLocation();
  const account = useAccount();
  const [subscribed, setSubscribed] = useState(false);

  const plan = plans?.find((each) => each.slug === slug);
  useTitleFocusAfterSignUp(plan !== undefined);

  if (isLoading && !plans) return <p>Loading the plan…</p>;
  if (error && !plans) {
    return (
      <p role="alert">
        The plans could not be read. <button onClick={() => refetch()}>Try again</button>
      </p>
    );
  }
  if (!plan) {
    return (
      <p>
        No plan is called “{slug}”. <Link to="/">Back to the plans</Link>
      </p>
    );
  }

  // A checkout is a customer's: a visitor makes an account first, and resumes this very page, with
  // the plan and the price they picked still in its address.
  if (!account.signedIn) return <SignUpStep plan={{ slug: plan.slug, name: plan.name }} />;

  return (
    <section aria-labelledby="checkout-title" className="page-narrow">
      <h1 id="checkout-title" className="page-heading">
        Subscribe to {plan.name}
      </h1>
      {/* Mounted on the page the customer comes back to from the provider's: see the README. */}
      <CheckoutFlow
        plan={plan}
        priceId={search.get("price") ?? undefined}
        portalHref="/portal"
        onSubscribed={() => setSubscribed(true)}
        onCancel={() => navigate("/")}
      />
      {subscribed ? (
        <p>
          <Link to="/portal">Go to your account</Link>
        </p>
      ) : null}
    </section>
  );
}
