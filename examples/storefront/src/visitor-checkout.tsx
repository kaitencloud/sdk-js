// Copyright 2026 KAITEN INC
// SPDX-License-Identifier: Apache-2.0

// What a visitor who has no account does at a plan's checkout. When the publishable key opens the anonymous
// checkout, they buy the plan right there: an e-mail, a security check, and, for a paid plan, a card on the
// provider's page. Kaiten makes the customer, its instance and the subscription when it completes, and the
// storefront's backend is not asked for anything. When the key does not open it, the visitor first makes an
// account (`SignUpStep`), and the checkout of a customer follows.

import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { KaitenClient, readCheckoutReturn } from "@kaitencloud/client";
import { AnonymousCheckoutFlow, type Plan } from "@kaitencloud/react-ui";

import type { StorefrontConfig } from "./config.ts";
import { Link, navigate } from "./router.tsx";
import { SignUpStep } from "./pages/sign-up-step.tsx";

/** The address of Kaiten and the publishable key, for the parts of the page that read the catalogue themselves. */
export const StorefrontConfigContext = createContext<StorefrontConfig | null>(null);

/**
 * Whether the catalogue says that this publishable key starts an anonymous checkout: `null` while it is read,
 * and `false` when it cannot be (the visitor then signs up, which needs no more than the plans did).
 *
 * The provider reads the catalogue for the plans already, and `AnonymousCheckoutFlow` draws nothing when it
 * says no; the page needs the answer itself to choose between the flow and the sign-up step.
 */
export function useAnonymousCheckoutOffered(): boolean | null {
  const config = useContext(StorefrontConfigContext);
  const [offered, setOffered] = useState<boolean | null>(null);
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    const client = new KaitenClient({
      apiUrl: config.apiUrl,
      authScheme: "publishable",
      tokenProvider: () => config.publishableKey,
    });
    client.getCatalog({ include: "none" }).then(
      (catalog) => {
        if (!cancelled) setOffered(catalog.capabilities?.anonymousCheckout === true);
      },
      () => {
        if (!cancelled) setOffered(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [config]);
  return offered;
}

/** A reference of the visitor's own that Kaiten echoes on the events of their checkout, here a made-up order number. */
function newOrderReference(): string {
  const random = crypto.getRandomValues(new Uint8Array(4));
  return `order-${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function VisitorCheckout({ plan, priceId }: { plan: Plan; priceId: string | undefined }) {
  const offered = useAnonymousCheckoutOffered();
  // Back from the provider's page, the checkout goes on whatever the catalogue says now.
  const [returning] = useState(() => readCheckoutReturn() !== null);
  const [reference] = useState(newOrderReference);
  const [completed, setCompleted] = useState(false);
  const title = useMemo(() => `Subscribe to ${plan.name}`, [plan.name]);

  if (offered === null && !returning) return <p>Loading the plan…</p>;
  if (!offered && !returning) {
    return <SignUpStep plan={{ slug: plan.slug, name: plan.name }} />;
  }

  return (
    <section aria-labelledby="checkout-title" className="page-narrow">
      <h1 id="checkout-title" className="page-heading">
        {title}
      </h1>
      {/* Mounted on the page the visitor comes back to from the provider's: see the README. */}
      <AnonymousCheckoutFlow
        plan={plan}
        priceId={priceId}
        clientReferenceId={reference}
        onComplete={() => setCompleted(true)}
        onCancel={() => navigate("/")}
      />
      {completed ? (
        <div className="panel visitor-done" data-testid="visitor-done">
          <p>
            Kaiten has made the customer and its instance for this address. It sends no e-mail to
            your buyers: a shop&rsquo;s backend hears of the order from the{" "}
            <code>checkout_session.v1.completed</code> event, which carries the reference{" "}
            <code>{reference}</code>, and gives the buyer their account.
          </p>
          <p>
            <Link to="/">Back to the plans</Link>
          </p>
        </div>
      ) : null}
    </section>
  );
}
