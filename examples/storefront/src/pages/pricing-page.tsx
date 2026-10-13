import { PricingTable } from "@kaitencloud/react-ui";

import { navigate } from "../router.tsx";

export function PricingPage() {
  return (
    <section aria-labelledby="pricing-title">
      <h1 id="pricing-title">Plans</h1>
      <PricingTable
        // A plan the visitor chose is bought on a page of its own: the provider's page brings the
        // customer back to the page they left, and that page has to be the checkout.
        onSelectPlan={(slug, _plan, price) =>
          navigate(`/checkout/${encodeURIComponent(slug)}${price?.id ? `?price=${price.id}` : ""}`)
        }
      />
    </section>
  );
}
