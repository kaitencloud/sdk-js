import { usePlans } from "@kaitencloud/react-ui";

import { Link, useLocation } from "../router.tsx";

/**
 * Where a customer who wants another plan, or a plan priced on request, is sent: the vendor's
 * "Talk to sales" page. The stand-in for Kaiten points every plan that is not free here (its
 * `selfServeCtaUrl`), and the portal's "Change plan" does too (see change-plan.ts). Nothing is sent
 * from it: the page gives the way to reach the team, and the plan the customer asks about.
 */
export function SalesPage() {
  const { search } = useLocation();
  const { data: plans } = usePlans();
  const asked = search.get("plan");
  const plan = plans?.find((each) => each.slug === asked);
  const subject = encodeURIComponent(plan ? `About the ${plan.name} plan` : "About my plan");

  return (
    <section aria-labelledby="sales-title" className="page-narrow">
      <div className="hero">
        <p className="eyebrow">Talk to sales</p>
        <h1 id="sales-title">
          {plan ? `Let's talk about ${plan.name}` : "Let's talk about your plan"}
        </h1>
        <p className="lead">
          Moving to another plan, or to one that is priced on request, is a conversation. Tell us
          where you are and what you need, and we come back to you with an offer.
        </p>
      </div>
      <div className="panel">
        <p>
          {plan ? (
            <>
              You are asking about <strong>{plan.name}</strong>.{" "}
            </>
          ) : null}
          Write to <a href={`mailto:sales@acme.test?subject=${subject}`}>sales@acme.test</a> and
          mention the name of your account.
        </p>
        <p className="muted">
          This is the page a plan&rsquo;s <code>selfServeCtaUrl</code> points at. In V1 the
          portal&rsquo;s &ldquo;Change plan&rdquo; opens it, since a plan change is a commercial
          request.
        </p>
        <p>
          <Link to="/portal">Back to your account</Link> &middot; <Link to="/">See the plans</Link>
        </p>
      </div>
    </section>
  );
}
