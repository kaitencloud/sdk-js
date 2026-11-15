// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from "react";

import { CheckoutFlow, usePlans } from "@kaitencloud/react-ui";

import { useAccount, useTitleFocusAfterSignUp } from "../account.tsx";
import { Link, navigate, useLocation } from "../router.tsx";
import { useDocumentTitle } from "../title.ts";
import { VisitorCheckout } from "../visitor-checkout.tsx";

/** A checkout of a plan the catalogue does not have: a page of its own, which says so and leads back. */
function PlanNotFound({ slug }: { slug: string }) {
  // The page is a new one to a keyboard or screen-reader user: they start at its title.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section aria-labelledby="not-found-title" className="page-narrow">
      <h1 ref={heading} tabIndex={-1} id="not-found-title" className="page-heading">
        Plan not found
      </h1>
      <p>No plan is called “{slug}”.</p>
      <p>
        <Link to="/">Back to the plans</Link>
      </p>
    </section>
  );
}

export function CheckoutPage({ slug }: { slug: string }) {
  const { data: plans, isLoading, error, refetch } = usePlans();
  const { search } = useLocation();
  const account = useAccount();
  const [subscribed, setSubscribed] = useState(false);

  const plan = plans?.find((each) => each.slug === slug);
  useTitleFocusAfterSignUp(plan !== undefined);
  useDocumentTitle(
    plan ? `Subscribe to ${plan.name}` : plans && !isLoading ? "Plan not found" : "Checkout",
  );

  if (isLoading && !plans) return <p role="status">Loading the plan…</p>;
  if (error && !plans) {
    return (
      <p role="alert">
        The plans could not be read. <button onClick={() => refetch()}>Try again</button>
      </p>
    );
  }
  if (!plan) return <PlanNotFound slug={slug} />;

  // A checkout is a customer's, and a visitor is not one yet. Where the publishable key opens the anonymous
  // checkout they buy the plan as they are; elsewhere they make an account first, and resume this very page,
  // with the plan and the price they picked still in its address.
  if (!account.signedIn)
    return <VisitorCheckout plan={plan} priceId={search.get("price") ?? undefined} />;

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
