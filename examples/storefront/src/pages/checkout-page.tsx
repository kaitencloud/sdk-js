import { useState } from "react";

import { CheckoutFlow, usePlans } from "@kaitencloud/react-ui";

import { Link, navigate, useLocation } from "../router.tsx";

export function CheckoutPage({ slug }: { slug: string }) {
  const { data: plans, isLoading, error, refetch } = usePlans();
  const { search } = useLocation();
  const [subscribed, setSubscribed] = useState(false);

  const plan = plans?.find((each) => each.slug === slug);

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

  return (
    <section aria-labelledby="checkout-title">
      <h1 id="checkout-title">Subscribe to {plan.name}</h1>
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
