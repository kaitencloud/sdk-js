// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

import { PricingTable } from "@kaitencloud/react-ui";

import { navigate } from "../router.tsx";

export function PricingPage() {
  return (
    <section aria-labelledby="pricing-title">
      <div className="hero">
        <p className="eyebrow">Pricing</p>
        <h1 id="pricing-title">Simple plans for every team</h1>
        <p className="lead">
          Pick the plan that fits, then change it or cancel it any time from your account.
        </p>
      </div>
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
